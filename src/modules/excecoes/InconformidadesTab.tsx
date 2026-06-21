// ════════════════════════════════════════════════════════════════════════════
//  Aba "Inconformidades" — compara as marcações de ponto reais (Sólides /
//  Tangerino) com a escala prevista cadastrada no Planejamento e lista as
//  não-conformidades. Casamento de colaborador por CPF.
//
//  Recebe rid + activeRestaurant da page-shell (RegistrosPontoPage).
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { fmtAnoMes, fmtBRDateTime, pad2 } from "../../core/utils/date";
import { derivedScheduleForEmpregado } from "../../core/escala/horarios";
import type {
  ApontamentoFuncionario,
  Area,
  Cargo,
  Empregado,
  EscalaMes,
  NotaInterna,
  Pessoa,
  Restaurant,
  ScheduleStatus,
} from "../../core/types";
import { AREAS, empregadoBatePonto } from "../../core/types";
import { fetchPunches, type SolidesDebug } from "../../core/excecoes/solidesClient";
import {
  buildEscalaFromSolides,
  buildHorariosPrevistosFromSolides,
  fetchSolidesSchedules,
} from "../../core/excecoes/solidesScheduleClient";
import { fetchSolidesAdjustments, aplicarAjustesNaEscala } from "../../core/excecoes/solidesAdjustmentsClient";
import { fetchSolidesLeaves, aplicarAfastamentosNaEscala } from "../../core/excecoes/solidesLeavesClient";
import { onlyDigits } from "../../core/excecoes/dayMetrics";
import { semanasDoMes, type SemanaInfo } from "../../core/excecoes/semanas";
import {
  adicionarApontamento,
  adicionarNotaInterna,
  listarStatusDoRestaurante,
  marcarApontamentoCiencia,
  removerApontamento,
  removerNotaInterna,
  salvarRelatorioCache,
} from "../../core/excecoes/statusSemana";
import { montarMensagemLoteAjuste, montarLinkWhats } from "../../core/excecoes/loteAjusteWhats";
import type { ExcecaoStatusSemana } from "../../core/types";
import {
  generateExceptionsReport,
  type GenerateReportResult,
} from "../../core/excecoes/generateReport";
import { RULES_META } from "../../core/excecoes/rules";
import type {
  ExceptionRecord,
  ExceptionSeverity,
  PontoApontamentoStatus,
} from "../../core/excecoes/types";
import { REGRA_CATEGORIA_DEFAULT } from "../../core/excecoes/types";
import {
  ouvirStatusDoMes,
  type PontoDiaStatusDoc,
} from "../../core/excecoes/statusDia";
import {
  setStatusApontamento,
  ouvirStatusApontamentoDoMes,
  apontamentoKey,
  isStatusTerminal,
  type PontoApontamentoStatusDoc,
} from "../../core/excecoes/statusApontamento";
import {
  ouvirLotesRascunhoDoRestaurante,
  adicionarAoLoteRascunhoFirestore,
  removerDoLoteRascunhoFirestore,
  limparLoteRascunho,
  registrarEnvioLote,
  type LoteRascunhoDoc,
} from "../../core/excecoes/loteRascunho";

// ─── Helpers de data ────────────────────────────────────────────────────────

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Data do "meio" do range [start, end] em YYYY-MM-DD. Usado pra buscar o
// quadro Sólides representativo do período (a Sólides retorna o quadro
// vigente naquela data; pra ranges longos com troca de quadro no meio o
// resultado pode ser parcial — fica como melhoria futura).
function midDate(start: string, end: string): string {
  const [ya, ma, da] = start.split("-").map(Number);
  const [yb, mb, db] = end.split("-").map(Number);
  const a = new Date(ya, ma - 1, da).getTime();
  const b = new Date(yb, mb - 1, db).getTime();
  const mid = new Date((a + b) / 2);
  const y = mid.getFullYear();
  const m = String(mid.getMonth() + 1).padStart(2, "0");
  const d = String(mid.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Lista de { ano, mes } cobertos pelo intervalo [start, end] (inclusive).
function monthsInRange(start: string, end: string): { ano: number; mes: number }[] {
  const out: { ano: number; mes: number }[] = [];
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard < 240) {
    out.push({ ano: y, mes: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    guard += 1;
  }
  return out;
}

// ─── Severidade: cores ──────────────────────────────────────────────────────

const SEVERITY_INFO: Record<
  ExceptionSeverity,
  { label: string; badge: string; dot: string }
> = {
  grave: {
    label: "Grave",
    badge: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    dot: "bg-rose-500",
  },
  aviso: {
    label: "Aviso",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  info: {
    label: "Info",
    badge: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
    dot: "bg-sky-500",
  },
};

// ─── Monta o contexto de escala prevista pra cada empregado ────────────────
// Base: escala derivada dos workSchedules. Override: a `prevista` cadastrada
// no doc /escalas/{rid}_{yyyy-mm} (tem prioridade quando existe).
async function buildEscalaContext(
  emps: Empregado[],
  rid: string,
  start: string,
  end: string,
): Promise<Record<string, Record<string, ScheduleStatus>>> {
  const meses = monthsInRange(start, end);
  const escalasPorMes = new Map<string, EscalaMes | null>();
  await Promise.all(
    meses.map(async ({ ano, mes }) => {
      const id = `${rid}_${fmtAnoMes(ano, mes)}`;
      const snap = await getDoc(doc(db, "escalas", id));
      escalasPorMes.set(
        `${ano}-${mes}`,
        snap.exists() ? ({ id: snap.id, ...snap.data() } as EscalaMes) : null,
      );
    }),
  );

  const ctx: Record<string, Record<string, ScheduleStatus>> = {};
  for (const emp of emps) {
    const perEmp: Record<string, ScheduleStatus> = {};
    for (const { ano, mes } of meses) {
      // Base: derivado dos workSchedules
      const derived = derivedScheduleForEmpregado(emp, ano, mes);
      for (const [date, dd] of Object.entries(derived)) {
        if (date < start || date > end) continue;
        perEmp[date] = dd.status;
      }
      // Override: prevista cadastrada
      const prev = escalasPorMes.get(`${ano}-${mes}`)?.prevista?.[emp.id];
      if (prev) {
        for (const [date, st] of Object.entries(prev)) {
          if (date < start || date > end) continue;
          perEmp[date] = st;
        }
      }
    }
    ctx[emp.id] = perEmp;
  }
  return ctx;
}

// ════════════════════════════════════════════════════════════════════════════

type Props = {
  rid: string;
  activeRestaurant: Restaurant;
};

export function InconformidadesTab({ rid, activeRestaurant }: Props) {
  const { pessoa: me } = useAuth();

  const [empregados, setEmpregados] = useState<Empregado[]>([]);

  // Mês selecionado (default = mês atual) + semana selecionada dentro do mês.
  const hojeRef = new Date();
  const [anoMes, setAnoMes] = useState<{ ano: number; mes: number }>({
    ano: hojeRef.getFullYear(),
    mes: hojeRef.getMonth() + 1,
  });
  const semanasMes = useMemo<SemanaInfo[]>(
    () => semanasDoMes(anoMes.ano, anoMes.mes),
    [anoMes.ano, anoMes.mes],
  );
  // Filtro multi-seleção de semanas pra VISUALIZAÇÃO. Vazio = mês todo
  // (default). Click em chip toggle (adiciona ou remove do Set). Atualizar
  // sempre regenera o mês todo via `atualizarMesTodo`.
  const [semanasFiltro, setSemanasFiltro] = useState<Set<number>>(new Set());

  // Resolve a SemanaInfo correspondente a uma data YYYY-MM-DD do mês visualizado.
  // Usado em ações por apontamento (dar ciência, WhatsApp etc) pra resolver
  // os endpoints `weekStart`/`weekEnd` a partir da data do fato em vez de
  // depender de uma semana ativa global.
  function semanaInfoParaData(date: string): SemanaInfo | null {
    return semanasMes.find((w) => w.weekStart <= date && w.weekEnd >= date) || null;
  }

  // Status do DIA (empregado × data) — listener real-time pro mês inteiro.
  // Não bloqueia exibição: começa vazio e popula assim que Firestore responde.
  const [statusDiaMap, setStatusDiaMap] = useState<Map<string, PontoDiaStatusDoc>>(new Map());
  useEffect(() => {
    if (!rid) { setStatusDiaMap(new Map()); return; }
    const u = ouvirStatusDoMes(rid, anoMes.ano, anoMes.mes, (docs) => {
      const m = new Map<string, PontoDiaStatusDoc>();
      docs.forEach(d => { m.set(`${d.empregadoId}_${d.data}`, d); });
      setStatusDiaMap(m);
    });
    return () => u();
  }, [rid, anoMes.ano, anoMes.mes]);

  // Status POR APONTAMENTO (granular) — listener real-time. Chave =
  // `${empregadoId}_${data}_${ruleId}`. Ausência ⇒ "aberto" (default).
  const [statusApontamentoMap, setStatusApontamentoMap] = useState<
    Map<string, PontoApontamentoStatusDoc>
  >(new Map());
  useEffect(() => {
    if (!rid) return;
    const u = ouvirStatusApontamentoDoMes(rid, anoMes.ano, anoMes.mes, (docs) => {
      const m = new Map<string, PontoApontamentoStatusDoc>();
      docs.forEach(d => {
        m.set(apontamentoKey(d.empregadoId, d.data, d.ruleId), d);
      });
      setStatusApontamentoMap(m);
    });
    return () => u();
  }, [rid, anoMes.ano, anoMes.mes]);
  // Caches de relatório de TODAS as semanas do restaurante — agora é a única
  // fonte de exibição. Recarregado quando muda o mês (e re-puxado ao fim do
  // loop em `atualizarMesTodo`).
  const [todosStatusDoRest, setTodosStatusDoRest] = useState<ExcecaoStatusSemana[]>([]);
  useEffect(() => {
    if (!rid) return;
    let cancelled = false;
    listarStatusDoRestaurante(rid)
      .then((rows) => {
        if (cancelled) return;
        setTodosStatusDoRest(rows);
      })
      .catch(() => {
        if (!cancelled) setTodosStatusDoRest([]);
      });
    return () => { cancelled = true; };
  }, [rid, anoMes.ano, anoMes.mes]);

  // statusSemana virou um agregado virtual derivado dos caches do mês —
  // só pra alimentar apontamentos/notas internas da UI (única coisa que ainda
  // vive em /excecoesStatusSemana). Status por semana (aberto/em_tratamento/
  // tratado_lider/conferido_gerente) NÃO é mais exposto nem editado.
  const statusAgregado = useMemo<ExcecaoStatusSemana | null>(() => {
    if (todosStatusDoRest.length === 0) return null;
    const mesPrefix = `${anoMes.ano}-${pad2(anoMes.mes)}-`;
    const cachesDoMes = todosStatusDoRest.filter(s =>
      (s.weekStart || "").startsWith(mesPrefix) ||
      (s.weekEnd || "").startsWith(mesPrefix)
    );
    if (cachesDoMes.length === 0) return null;
    const apontamentos = cachesDoMes.flatMap(s => s.apontamentos || []);
    const notasInternas = cachesDoMes.flatMap(s => s.notasInternas || []);
    return {
      ...cachesDoMes[0],
      apontamentos,
      notasInternas,
    };
  }, [todosStatusDoRest, anoMes.ano, anoMes.mes]);

  function navegaMes(delta: number) {
    setAnoMes((cur) => {
      const d = new Date(cur.ano, cur.mes - 1 + delta, 1);
      return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
    });
    setSemanasFiltro(new Set());
  }

  // ─── Apontamentos por empregado ────────────────────────────────────────────
  // O líder marca os checkboxes em cada inconformidade pra criar apontamentos
  // (status="pendente"). Ao disparar o WhatsApp, viram "enviado". Pra
  // apontamentos não-tratáveis (intervalo a menos passado), o líder clica em
  // "Ciência" → status="ciencia" (fica registrado mas não vai pro empregado).
  // Anotações livres viram NOTAS INTERNAS (não vão pro WhatsApp).
  // semanaConferida: não existe mais bloqueio por status — qualquer ação é
  // permitida desde que a semana esteja dentro do mês visualizado.
  const semanaConferida = false;

  // Cruza CPF → empregadoId do Planejamento. exc.employeeId é o ID da Sólides
  // (number), não casa com /empregados/{id} — precisamos do ID local pra
  // ancorar o apontamento e cruzar com Pessoa.whatsapp depois.
  const empIdByCpf = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of empregados) {
      const cpf = (e.cpf || "").replace(/\D/g, "");
      if (cpf) m.set(cpf, e.id);
    }
    return m;
  }, [empregados]);

  // Recarrega caches do mês inteiro — usado depois de uma ação por apontamento
  // pra refletir o novo estado na UI agregada.
  async function recarregarCaches() {
    try {
      const rows = await listarStatusDoRestaurante(rid);
      setTodosStatusDoRest(rows);
    } catch (e) {
      console.warn("[ponto] falha ao recarregar caches:", e);
    }
  }

  // Resolve o apontamento existente (se houver) pra uma inconformidade,
  // identificado pela tripla (empregadoId, data, ruleId). Procura nos
  // caches agregados do mês.
  function acharApontamento(empregadoId: string, data: string, ruleId: string) {
    return (statusAgregado?.apontamentos || []).find(
      (a) =>
        a.origem === "inconformidade" &&
        a.empregadoId === empregadoId &&
        a.data === data &&
        a.ruleId === ruleId,
    );
  }

  // Resolve empregadoId Planejamento a partir do CPF da inconformidade. Mostra
  // alerta se não achar.
  function resolverEmpId(exc: ExceptionRecord): string | null {
    const cpfD = (exc.cpf || "").replace(/\D/g, "");
    const empId = empIdByCpf.get(cpfD);
    if (!empId) {
      alert(`Não achei empregado com CPF ${exc.cpf} no Planejamento. Cadastre em Pessoas pra poder marcar.`);
      return null;
    }
    return empId;
  }

  function gerarTextoApontamento(exc: ExceptionRecord): string {
    const meta = RULES_META[exc.ruleId];
    return `${meta.label} em ${fmtDataBr(exc.date)}: ${exc.description}${
      exc.detail ? ` (${exc.detail})` : ""
    }`;
  }

  // Toggle do checkbox "enviar pro WhatsApp" — marca como "pendente" ou remove.
  // Se o apontamento já está "enviado"/"ciencia", desmarcar volta pra "pendente"
  // (em outras palavras: o checkbox em itens finalizados serve pra REABRIR).
  async function toggleEnviarExcecao(exc: ExceptionRecord) {
    if (!me) return;
    const wk = semanaInfoParaData(exc.date);
    if (!wk) {
      console.warn(`[ponto] semana não encontrada pra data ${exc.date} no mês visualizado`);
      return;
    }
    const empId = resolverEmpId(exc);
    if (!empId) return;
    const existente = acharApontamento(empId, exc.date, exc.ruleId);
    try {
      if (existente && existente.status === "pendente") {
        // Desmarca pendente → remove
        await removerApontamento(rid, wk.weekStart, wk.weekEnd, existente.id);
        await recarregarCaches();
      } else if (existente) {
        // Já enviado/ciência → não toca (use botão dedicado pra reabrir)
        alert(
          existente.status === "enviado"
            ? `Empregado já avisado em ${existente.enviadoEm ? fmtDataHora(existente.enviadoEm) : "?"}. Pra reabrir, use o botão "↩ reabrir".`
            : `Já marcado como ciência por ${existente.cienciaPorNome}. Pra reabrir, use o botão "↩ reabrir".`,
        );
      } else {
        await adicionarApontamento(
          rid,
          wk.weekStart,
          wk.weekEnd,
          {
            empregadoId: empId,
            empregadoNome: exc.employeeName,
            cpf: exc.cpf,
            texto: gerarTextoApontamento(exc),
            data: exc.date,
            origem: "inconformidade",
            ruleId: exc.ruleId,
          },
          me,
          "pendente",
        );
        await recarregarCaches();
      }
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  }

  // Marca a inconformidade como "ciência" — fica registrado mas NÃO vai pro
  // WhatsApp (caso clássico: intervalo a menos que já passou, fica só pra log).
  async function darCienciaExcecao(exc: ExceptionRecord) {
    if (!me) return;
    const wk = semanaInfoParaData(exc.date);
    if (!wk) {
      console.warn(`[ponto] semana não encontrada pra data ${exc.date}`);
      return;
    }
    const empId = resolverEmpId(exc);
    if (!empId) return;
    const existente = acharApontamento(empId, exc.date, exc.ruleId);
    try {
      let apontamentoId: string;
      if (existente) {
        await marcarApontamentoCiencia(rid, wk.weekStart, wk.weekEnd, existente.id, me);
        apontamentoId = existente.id;
      } else {
        const updated = await adicionarApontamento(
          rid,
          wk.weekStart,
          wk.weekEnd,
          {
            empregadoId: empId,
            empregadoNome: exc.employeeName,
            cpf: exc.cpf,
            texto: gerarTextoApontamento(exc),
            data: exc.date,
            origem: "inconformidade",
            ruleId: exc.ruleId,
          },
          me,
          "ciencia",
        );
        apontamentoId = (updated.apontamentos || []).slice(-1)[0]?.id || "";
      }
      // Cria nota interna automática registrando a ciência → timeline completa
      try {
        await adicionarNotaInterna(
          rid,
          wk.weekStart,
          wk.weekEnd,
          {
            empregadoId: empId,
            empregadoNome: exc.employeeName,
            texto: `👁 Ciência tomada (não-tratável retroativo): ${gerarTextoApontamento(exc)}`,
            origem: "ciencia",
            apontamentoIds: [apontamentoId],
          },
          me,
        );
      } catch (e) {
        console.warn("Erro criando nota auto de ciência:", e);
      }
      await recarregarCaches();
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  }
  // Mantida na codebase pra possível re-uso futuro (era ciência individual,
  // virou ação em lote via `darCienciaPendentesDoEmpregado`).
  void darCienciaExcecao;

  // Reabre apontamento finalizado (enviado ou ciência) → vira pendente.
  // Remove o apontamento — próxima ação do líder cria de novo se quiser.
  async function reabrirExcecao(exc: ExceptionRecord) {
    if (!me) return;
    const wk = semanaInfoParaData(exc.date);
    if (!wk) {
      console.warn(`[ponto] semana não encontrada pra data ${exc.date}`);
      return;
    }
    const empId = resolverEmpId(exc);
    if (!empId) return;
    const existente = acharApontamento(empId, exc.date, exc.ruleId);
    if (!existente) return;
    if (!confirm("Reabrir esse apontamento? Vai voltar pra pendente.")) return;
    try {
      await removerApontamento(rid, wk.weekStart, wk.weekEnd, existente.id);
      await recarregarCaches();
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  }
  // `toggleEnviarExcecao` e `reabrirExcecao` viraram retroatividade do
  // fluxo legado (checkbox + WhatsApp) — ainda existem mas a UI nova de
  // status por apontamento usa o caminho `aplicarStatusApontamento`.
  // Mantemos os helpers no escopo pra reuso futuro/manual.
  void toggleEnviarExcecao;
  void reabrirExcecao;

  // Map (empregadoId_data_ruleId) → apontamento existente. Alimenta a UI pra
  // saber o status visual e o botão a renderizar.
  const apontamentosPorChave = useMemo(() => {
    const m = new Map<string, ApontamentoFuncionario>();
    for (const a of statusAgregado?.apontamentos || []) {
      if (a.origem === "inconformidade" && a.ruleId && a.data) {
        m.set(`${a.empregadoId}_${a.data}_${a.ruleId}`, a);
      }
    }
    return m;
  }, [statusAgregado?.apontamentos]);

  // Nota interna vinculada a UM apontamento específico (empregado × data × regra).
  // Aparece dentro do card desse apontamento; aceita texto pré-digitado (vindo de
  // prompt() ou input controlado). Texto vazio → noop.
  async function adicionarNotaApontamento(
    empregadoId: string,
    empregadoNome: string,
    exc: ExceptionRecord,
    texto: string,
  ) {
    if (!me) return;
    if (!empregadoId || !texto.trim()) return;
    const wk = semanaInfoParaData(exc.date) || semanasMes[0];
    if (!wk) {
      alert("Sem semana disponível pra ancorar a nota.");
      return;
    }
    try {
      await adicionarNotaInterna(
        rid,
        wk.weekStart,
        wk.weekEnd,
        {
          empregadoId,
          empregadoNome,
          texto: texto.trim(),
          origem: "manual",
          apontamentoChave: `${exc.date}_${exc.ruleId}`,
        },
        me,
      );
      await recarregarCaches();
    } catch (e) {
      alert("Erro ao salvar nota: " + (e instanceof Error ? e.message : "?"));
    }
  }

  async function apagarNotaInterna(notaId: string) {
    if (!me) return;
    if (!confirm("Apagar essa nota interna?")) return;
    // Acha em qual semana a nota tá ancorada
    const cache = todosStatusDoRest.find(s => (s.notasInternas || []).some(n => n.id === notaId));
    if (!cache) {
      console.warn(`[ponto] semana não encontrada pra nota ${notaId}`);
      return;
    }
    try {
      await removerNotaInterna(rid, cache.weekStart, cache.weekEnd, notaId);
      await recarregarCaches();
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  }

  // Agrupa notas internas por empregado
  const notasPorEmpregado = useMemo(() => {
    const m = new Map<string, NotaInterna[]>();
    for (const n of statusAgregado?.notasInternas || []) {
      const arr = m.get(n.empregadoId) || [];
      arr.push(n);
      m.set(n.empregadoId, arr);
    }
    return m;
  }, [statusAgregado?.notasInternas]);

  // ─── Status por APONTAMENTO ─────────────────────────────────────────────
  //
  // Aplica novo status num apontamento individual e, se com isso TODOS os
  // apontamentos do dia ficarem terminais E pelo menos 1 deles for
  // "alinhamento", gera 1 evento na Trilha do empregado (ponto_atraso —
  // usamos o tipo existente mais próximo de "evento disciplinar de ponto").
  // Idempotente: registrarEvento usa refOrigem `apontamento_dia_tratado:<empId>:<date>`.
  async function aplicarStatusApontamento(input: {
    empregadoId: string;
    empregadoNome: string;
    data: string;
    ruleId: string;
    novoStatus: PontoApontamentoStatus;
  }) {
    if (!me) {
      alert("Sem usuário logado — recarrega a página e tenta de novo.");
      return;
    }
    if (!input.empregadoId) {
      alert("Empregado sem id no Planejamento (provavelmente o CPF não casa com o cadastro). Confira na aba Compatibilidade.");
      return;
    }
    const lockKey = apontamentoKey(input.empregadoId, input.data, input.ruleId);
    setSalvandoApontamento((prev) => new Set(prev).add(lockKey));
    // Captura o doc anterior pra poder REVERTER caso o write Firestore falhe.
    const docAnterior = statusApontamentoMap.get(lockKey);
    // Atualização otimista PRIMEIRO — UI vira na hora. Quando o write
    // Firestore confirmar, o listener real-time entrega o doc real (igual ao
    // otimista), sem flash visual. Se o write falhar, revertemos abaixo.
    const otimista: PontoApontamentoStatusDoc = {
      id: `${rid}_${input.empregadoId}_${input.data}_${input.ruleId}`,
      restaurantId: rid,
      empregadoId: input.empregadoId,
      data: input.data,
      ruleId: input.ruleId,
      status: input.novoStatus,
      atualizadoEm: new Date().toISOString(),
      atualizadoPor: me.id,
      atualizadoPorNome: me.nome,
    };
    setStatusApontamentoMap((prev) => {
      const next = new Map(prev);
      next.set(lockKey, otimista);
      return next;
    });
    // Se o novo status é terminal (ciência, falso positivo, corrigido)
    // e o apontamento estava no lote, tira automaticamente — o apontamento
    // foi resolvido, não faz sentido continuar no box amarelo.
    // Status 'empresa_ajustara' NÃO é terminal mas tem fluxo próprio (entra
    // no lote como item de empresa). Pular ele aqui evita loop.
    if (isStatusTerminal(input.novoStatus)) {
      const chavesLote = loteChavesDo(input.empregadoId);
      if (chavesLote.has(lockKey)) {
        removerDoLote(input.empregadoId, lockKey);
      }
    }
    try {
      await setStatusApontamento({
        restaurantId: rid,
        empregadoId: input.empregadoId,
        data: input.data,
        ruleId: input.ruleId,
        novoStatus: input.novoStatus,
        por: { id: me.id, nome: me.nome },
      });
    } catch (e) {
      console.error("[ponto] setStatusApontamento falhou:", e);
      // Reverte o otimismo — restaura o doc anterior (ou remove se não havia).
      setStatusApontamentoMap((prev) => {
        const next = new Map(prev);
        if (docAnterior) next.set(lockKey, docAnterior);
        else next.delete(lockKey);
        return next;
      });
      alert("Falha ao atualizar status: " + (e instanceof Error ? e.message : String(e)));
      return;
    } finally {
      setSalvandoApontamento((prev) => {
        const next = new Set(prev);
        next.delete(lockKey);
        return next;
      });
    }

    // Pós-write: verifica se o dia inteiro ficou terminal. Como o listener
    // real-time pode demorar, simulamos o map atualizado localmente.
    if (!isStatusTerminal(input.novoStatus)) return;
    if (!displayedResult) return;

    const exDoDia = displayedResult.exceptions.filter((e) => {
      const cpfD = (e.cpf || "").replace(/\D/g, "");
      const empId = empIdByCpf.get(cpfD);
      return empId === input.empregadoId && e.date === input.data;
    });
    if (exDoDia.length === 0) return;

    // Status efetivo de cada exception do dia (combina map + status novo simulado)
    const statusPorEx = exDoDia.map((e) => {
      if (e.ruleId === input.ruleId) {
        return { rule: e.ruleId, status: input.novoStatus as PontoApontamentoStatus };
      }
      const k = apontamentoKey(input.empregadoId, e.date, e.ruleId);
      const doc = statusApontamentoMap.get(k);
      // Fallback "migração suave": dia legado terminal ⇒ ciência implícita
      if (!doc) {
        const diaDoc = statusDiaMap.get(`${input.empregadoId}_${e.date}`);
        if (diaDoc && (diaDoc.status === "tratado" || diaDoc.status === "corrigido_solides")) {
          return { rule: e.ruleId, status: "ciencia" as PontoApontamentoStatus };
        }
      }
      return { rule: e.ruleId, status: (doc?.status || "aberto") as PontoApontamentoStatus };
    });
    const todosTerminais = statusPorEx.every((x) => isStatusTerminal(x.status));
    if (!todosTerminais) return;

    // Categoria por rule: precisa ter ao menos 1 alinhamento REAL (ciência
    // dada). Apontamentos marcados como "nao_e_inconformidade" (falso
    // positivo / combinado / justificado) NÃO contam — não gera Trilha
    // se todos foram dispensados como falsos positivos.
    const temAlinhamentoReal = statusPorEx.some((x) =>
      REGRA_CATEGORIA_DEFAULT[x.rule] === "alinhamento" && x.status === "ciencia",
    );
    if (!temAlinhamentoReal) return;

    // Gera 1 evento por dia na Trilha (idempotente).
    try {
      const { registrarEvento } = await import("../trilha/repository");
      await registrarEvento({
        restaurantId: rid,
        empregadoId: input.empregadoId,
        empregadoNomeSnapshot: input.empregadoNome,
        tipo: "ponto_atraso",
        data: input.data,
        titulo: `Inconformidades alinhadas em ${fmtDataBr(input.data)}`,
        descricao: exDoDia
          .map((e) => `• ${RULES_META[e.ruleId]?.label || e.ruleId}: ${e.description}`)
          .join("\n"),
        metadados: {
          totalApontamentos: exDoDia.length,
          regras: exDoDia.map((e) => e.ruleId),
        },
        fonte: "auto",
        refOrigem: `apontamento_dia_tratado:${input.empregadoId}:${input.data}`,
        registradoPor: { id: me.id, nome: me.nome },
      });
    } catch (e) {
      console.warn("[ponto] falha ao registrar trilha do dia tratado:", e);
    }
  }

  // Wrapper pra reabrir um apontamento — volta pra "aberto".
  async function reabrirApontamento(input: {
    empregadoId: string;
    empregadoNome: string;
    data: string;
    ruleId: string;
  }) {
    if (!me) return;
    const lockKey = apontamentoKey(input.empregadoId, input.data, input.ruleId);
    setSalvandoApontamento((prev) => new Set(prev).add(lockKey));
    // Otimismo PRIMEIRO — captura doc anterior pra reverter em caso de erro.
    const docAnterior = statusApontamentoMap.get(lockKey);
    setStatusApontamentoMap((prev) => {
      const next = new Map(prev);
      next.delete(lockKey);
      return next;
    });
    try {
      await setStatusApontamento({
        restaurantId: rid,
        empregadoId: input.empregadoId,
        data: input.data,
        ruleId: input.ruleId,
        novoStatus: "aberto",
        por: { id: me.id, nome: me.nome },
      });
    } catch (e) {
      console.error("[ponto] reabrir apontamento falhou:", e);
      if (docAnterior) {
        setStatusApontamentoMap((prev) => {
          const next = new Map(prev);
          next.set(lockKey, docAnterior);
          return next;
        });
      }
      alert("Falha ao reabrir: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSalvandoApontamento((prev) => {
        const next = new Set(prev);
        next.delete(lockKey);
        return next;
      });
    }
  }

  // Conjunto de apontamentos atualmente sendo salvos (lockKey).
  // Usado pra disabled + texto "salvando…" no botão.
  const [salvandoApontamento, setSalvandoApontamento] = useState<Set<string>>(new Set());

  // ─── Lote de solicitação de ajuste (rascunho persistido) ─────────────────
  // Map empregadoId → doc completo do lote (chaves + metadados de envio).
  // Sincronizado em tempo real com Firestore (/excecoesLoteRascunho/{rid}_{empId}).
  // O líder pode fechar a aba, continuar depois, ou montar lotes pra vários
  // empregados e enviar tudo de uma vez. Quando envia (whatsapp/presencial),
  // grava enviadoEm — o box continua visível com botão "Reenviar".
  // Update otimista: a UI muda imediatamente; a escrita Firestore roda em
  // background. Se falhar, próximo snapshot do listener corrige.
  const [lotesDocs, setLotesDocs] = useState<Map<string, LoteRascunhoDoc>>(new Map());

  // Helper: chaves do lote dum empregado (Set, ou Set vazio).
  const loteChavesDo = useCallback((empregadoId: string): Set<string> => {
    return new Set(lotesDocs.get(empregadoId)?.apontamentoChaves || []);
  }, [lotesDocs]);

  // Hidrata o map a partir do Firestore (real-time). Cada doc da coleção
  // /excecoesLoteRascunho vira uma entry no map.
  useEffect(() => {
    if (!rid) return;
    const unsub = ouvirLotesRascunhoDoRestaurante(rid, (docs) => {
      const next = new Map<string, LoteRascunhoDoc>();
      for (const d of docs) {
        if (!d.empregadoId) continue;
        next.set(d.empregadoId, d);
      }
      setLotesDocs(next);
    });
    return unsub;
  }, [rid]);

  function adicionarAoLote(empregadoId: string, lockKey: string) {
    // Otimismo no client + arrayUnion no Firestore (atômico, sem race entre
    // clicks rápidos). Se o write falhar, o listener real-time corrige
    // eventualmente; em caso de falha grave logamos pro console.
    if (!me) return;
    const meSnap = me;
    setLotesDocs((prev) => {
      const next = new Map(prev);
      const existing = next.get(empregadoId);
      const chaves = new Set(existing?.apontamentoChaves || []);
      chaves.add(lockKey);
      next.set(empregadoId, {
        id: existing?.id || `${rid}_${empregadoId}`,
        restaurantId: rid,
        empregadoId,
        apontamentoChaves: Array.from(chaves),
        atualizadoEm: new Date().toISOString(),
        atualizadoPor: meSnap.id,
        atualizadoPorNome: meSnap.nome,
        // Preserva metadados de envio anteriores
        ...(existing?.enviadoEm ? {
          enviadoEm: existing.enviadoEm,
          enviadoTipo: existing.enviadoTipo,
          enviadoPor: existing.enviadoPor,
          enviadoPorNome: existing.enviadoPorNome,
        } : {}),
        ...(existing?.reenvios ? { reenvios: existing.reenvios } : {}),
      });
      return next;
    });
    void adicionarAoLoteRascunhoFirestore({
      restaurantId: rid,
      empregadoId,
      apontamentoChave: lockKey,
      por: { id: meSnap.id, nome: meSnap.nome },
    }).catch((e) => console.warn("[ponto] add ao lote falhou:", e));
  }

  function removerDoLote(empregadoId: string, lockKey: string) {
    if (!me) return;
    const meSnap = me;
    setLotesDocs((prev) => {
      const next = new Map(prev);
      const existing = next.get(empregadoId);
      if (!existing) return prev;
      const chaves = new Set(existing.apontamentoChaves || []);
      chaves.delete(lockKey);
      next.set(empregadoId, {
        ...existing,
        apontamentoChaves: Array.from(chaves),
        atualizadoEm: new Date().toISOString(),
        atualizadoPor: meSnap.id,
        atualizadoPorNome: meSnap.nome,
      });
      return next;
    });
    void removerDoLoteRascunhoFirestore({
      restaurantId: rid,
      empregadoId,
      apontamentoChave: lockKey,
      por: { id: meSnap.id, nome: meSnap.nome },
    }).catch((e) => console.warn("[ponto] remove do lote falhou:", e));
  }

  function cancelarLote(empregadoId: string) {
    setLotesDocs((prev) => {
      const next = new Map(prev);
      next.delete(empregadoId);
      return next;
    });
    void limparLoteRascunho({ restaurantId: rid, empregadoId });
  }

  // Toggle: se já está no lote, tira; senão, adiciona. Usado pelo botão
  // "📦 + Lote" / "↩ Tirar do lote" da coluna direita.
  function toggleLote(empregadoId: string, exc: ExceptionRecord) {
    const lockKey = apontamentoKey(empregadoId, exc.date, exc.ruleId);
    const chaves = loteChavesDo(empregadoId);
    if (chaves.has(lockKey)) {
      removerDoLote(empregadoId, lockKey);
    } else {
      adicionarAoLote(empregadoId, lockKey);
    }
  }

  // "🏢 Empresa resolve": adiciona ao lote E marca status como
  // empresa_ajustara. Aparece no box amarelo igual aos do empregado mas
  // com badge diferente; quando envia o lote pelo WhatsApp, é filtrado da
  // mensagem (a empresa resolve direto na Sólides — não vai pro empregado).
  async function marcarEmpresaResolve(empregadoId: string, exc: ExceptionRecord) {
    if (!me) {
      alert("Sem usuário logado.");
      return;
    }
    const lockKey = apontamentoKey(empregadoId, exc.date, exc.ruleId);
    const jaNoLote = loteChavesDo(empregadoId).has(lockKey);
    if (!jaNoLote) adicionarAoLote(empregadoId, lockKey);
    await aplicarStatusApontamento({
      empregadoId,
      empregadoNome: exc.employeeName,
      data: exc.date,
      ruleId: exc.ruleId,
      novoStatus: "empresa_ajustara",
    });
  }

  // Resolve os apontamentos do lote de um empregado em ExceptionRecord[],
  // consultando displayedResult.exceptions. Filtra pra garantir 1 por
  // (data, ruleId) — mesmo se vierem duplicados, agregamos um só.
  function resolverApontamentosDoLote(empregadoId: string): ExceptionRecord[] {
    const set = loteChavesDo(empregadoId);
    if (set.size === 0 || !displayedResult) return [];
    const vistos = new Set<string>();
    const out: ExceptionRecord[] = [];
    for (const exc of displayedResult.exceptions) {
      const cpfD = (exc.cpf || "").replace(/\D/g, "");
      const empId = empIdByCpf.get(cpfD);
      if (empId !== empregadoId) continue;
      const key = apontamentoKey(empregadoId, exc.date, exc.ruleId);
      if (!set.has(key)) continue;
      if (vistos.has(key)) continue;
      vistos.add(key);
      out.push(exc);
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  }

  // Marca em paralelo todos os apontamentos do lote como "aguardando_ajuste".
  // PULA apontamentos já em "empresa_ajustara" (esses não vão pro empregado
  // e o status fica como está — empresa vai resolver na Sólides).
  // Update otimista no statusApontamentoMap local pra a UI virar antes do
  // listener confirmar. Em caso de erro, mantém o lote local pro usuário
  // tentar de novo.
  async function marcarLoteAguardandoAjuste(
    empregadoId: string,
    apontamentos: ExceptionRecord[],
  ): Promise<boolean> {
    if (!me) {
      alert("Sem usuário logado — recarrega a página e tenta de novo.");
      return false;
    }
    const paraMarcar = apontamentos.filter((e) => {
      const k = apontamentoKey(empregadoId, e.date, e.ruleId);
      return statusApontamentoMap.get(k)?.status !== "empresa_ajustara";
    });
    if (paraMarcar.length === 0) return true;
    try {
      await Promise.all(
        paraMarcar.map((e) =>
          setStatusApontamento({
            restaurantId: rid,
            empregadoId,
            data: e.date,
            ruleId: e.ruleId,
            novoStatus: "aguardando_ajuste",
            por: { id: me.id, nome: me.nome },
          }),
        ),
      );
      // Update otimista: já marca no map local pra UI virar antes do
      // listener real-time chegar.
      setStatusApontamentoMap((prev) => {
        const next = new Map(prev);
        for (const e of paraMarcar) {
          const k = apontamentoKey(empregadoId, e.date, e.ruleId);
          next.set(k, {
            id: `${rid}_${empregadoId}_${e.date}_${e.ruleId}`,
            restaurantId: rid,
            empregadoId,
            data: e.date,
            ruleId: e.ruleId,
            status: "aguardando_ajuste",
            atualizadoEm: new Date().toISOString(),
            atualizadoPor: me.id,
            atualizadoPorNome: me.nome,
          });
        }
        return next;
      });
      return true;
    } catch (e) {
      console.error("[ponto] marcarLoteAguardandoAjuste falhou:", e);
      alert("Falha ao marcar lote: " + (e instanceof Error ? e.message : String(e)));
      return false;
    }
  }

  // Registra um envio do lote no Firestore (1º envio → enviadoEm; subsequentes
  // → append em reenvios). Atualiza o state local otimisticamente.
  async function registrarEnvioLocal(empregadoId: string, tipo: "whatsapp" | "presencial") {
    if (!me) return;
    const meSnap = me;
    const agoraIso = new Date().toISOString();
    let jaTinhaEnvio = false;
    setLotesDocs((prev) => {
      const next = new Map(prev);
      const existing = next.get(empregadoId);
      if (!existing) return prev;
      jaTinhaEnvio = !!existing.enviadoEm;
      if (jaTinhaEnvio) {
        const reenvios = existing.reenvios || [];
        next.set(empregadoId, {
          ...existing,
          reenvios: [...reenvios, { em: agoraIso, tipo, por: meSnap.id, porNome: meSnap.nome }],
          atualizadoEm: agoraIso,
          atualizadoPor: meSnap.id,
          atualizadoPorNome: meSnap.nome,
        });
      } else {
        next.set(empregadoId, {
          ...existing,
          enviadoEm: agoraIso,
          enviadoTipo: tipo,
          enviadoPor: meSnap.id,
          enviadoPorNome: meSnap.nome,
          atualizadoEm: agoraIso,
          atualizadoPor: meSnap.id,
          atualizadoPorNome: meSnap.nome,
        });
      }
      return next;
    });
    try {
      await registrarEnvioLote({
        restaurantId: rid,
        empregadoId,
        tipo,
        por: { id: meSnap.id, nome: meSnap.nome },
        jaTinhaEnvio,
      });
    } catch (e) {
      console.warn("[ponto] registrar envio do lote falhou:", e);
    }
  }

  async function enviarLoteWhats(empregadoId: string) {
    const apontamentos = resolverApontamentosDoLote(empregadoId);
    if (apontamentos.length === 0) {
      alert("Lote vazio.");
      return;
    }
    // Filtra fora os marcados como 'empresa_ajustara' — esses não vão pro
    // empregado (empresa resolve direto na Sólides).
    const paraEmpregado = apontamentos.filter((a) => {
      const k = apontamentoKey(empregadoId, a.date, a.ruleId);
      return statusApontamentoMap.get(k)?.status !== "empresa_ajustara";
    });
    if (paraEmpregado.length === 0) {
      alert("Todos os itens do lote estão marcados como 'empresa resolve' — nada pra enviar pro empregado.");
      return;
    }
    const empregado = empregados.find((e) => e.id === empregadoId);
    const empregadoNome = empregado?.nome || paraEmpregado[0].employeeName || "";
    const whatsapp = whatsByEmpId.get(empregadoId);
    if (!whatsapp) {
      alert(`${empregadoNome} não tem WhatsApp cadastrado em Pessoas.`);
      return;
    }
    const msg = montarMensagemLoteAjuste({
      empregadoNome,
      restNome: activeRestaurant.nome,
      apontamentos: paraEmpregado.map((a) => ({
        date: a.date,
        ruleId: a.ruleId,
        description: a.description,
        detail: a.detail,
        batidas: a.batidas,
      })),
    });
    const link = montarLinkWhats(whatsapp, msg);
    window.open(link, "_blank");
    const ok = await marcarLoteAguardandoAjuste(empregadoId, paraEmpregado);
    if (ok) await registrarEnvioLocal(empregadoId, "whatsapp");
  }

  // Gera PDF consolidado de TODOS os lotes em aberto (qualquer empregado
  // do restaurante). Compõe a lista a partir do state local atual + dos
  // ExceptionRecord do displayedResult pra resolver os apontamentos.
  // Mostra um preview ANTES de baixar — o líder confere o conteúdo antes
  // de imprimir/distribuir.
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [previewPdf, setPreviewPdf] = useState<{ url: string; filename: string } | null>(null);
  async function gerarPdfLotes() {
    if (lotesDocs.size === 0) {
      alert("Nenhum lote aberto.");
      return;
    }
    setGerandoPdf(true);
    try {
      const { gerarLotesPDF } = await import("./gerarLotesPDF");
      const empregadosPdf = [] as Array<{
        empregadoId: string;
        nome: string;
        cpf?: string;
        apontamentos: { date: string; ruleId: string; description: string; detail?: string; batidas?: string }[];
        lote?: LoteRascunhoDoc;
      }>;
      for (const [empregadoId, loteDoc] of lotesDocs) {
        if ((loteDoc.apontamentoChaves?.length || 0) === 0) continue;
        const apontamentos = resolverApontamentosDoLote(empregadoId);
        if (apontamentos.length === 0) continue;
        const emp = empregados.find((e) => e.id === empregadoId);
        const nome = emp?.nome || apontamentos[0].employeeName || "—";
        const cpf = emp?.cpf || apontamentos[0].cpf;
        empregadosPdf.push({
          empregadoId,
          nome,
          cpf,
          apontamentos: apontamentos.map((a) => ({
            date: a.date,
            ruleId: a.ruleId,
            description: a.description,
            detail: a.detail,
            batidas: a.batidas,
          })),
          lote: loteDoc,
        });
      }
      empregadosPdf.sort((a, b) => a.nome.localeCompare(b.nome));

      // Apontamentos marcados como "empresa vai resolver" no mês ativo.
      // Varre o map de status × exceptions do displayedResult.
      const empresaResolveItens: Array<{
        empregadoId: string;
        empregadoNome: string;
        cpf?: string;
        date: string;
        ruleId: string;
        description: string;
        detail?: string;
        batidas?: string;
      }> = [];
      if (displayedResult) {
        for (const exc of displayedResult.exceptions) {
          const cpfD = (exc.cpf || "").replace(/\D/g, "");
          const empId = empIdByCpf.get(cpfD);
          if (!empId) continue;
          const k = apontamentoKey(empId, exc.date, exc.ruleId);
          const st = statusApontamentoMap.get(k)?.status;
          if (st !== "empresa_ajustara") continue;
          const emp = empregados.find((e) => e.id === empId);
          empresaResolveItens.push({
            empregadoId: empId,
            empregadoNome: emp?.nome || exc.employeeName,
            cpf: emp?.cpf || exc.cpf,
            date: exc.date,
            ruleId: exc.ruleId,
            description: exc.description,
            detail: exc.detail,
            batidas: exc.batidas,
          });
        }
      }

      if (empregadosPdf.length === 0 && empresaResolveItens.length === 0) {
        alert("Nenhum lote nem item marcado para empresa resolver.");
        return;
      }
      const docPdf = await gerarLotesPDF({
        ano: anoMes.ano,
        mes: anoMes.mes,
        restaurantNome: activeRestaurant.nome,
        empregados: empregadosPdf,
        empresaResolve: empresaResolveItens,
      });
      // Em vez de baixar direto, gera blob URL e abre preview modal.
      const blob = docPdf.output("blob");
      const url = URL.createObjectURL(blob);
      const filename = `pedidos-ajuste-${activeRestaurant.nome.toLowerCase().replace(/\s+/g, "-")}-${anoMes.ano}-${pad2(anoMes.mes)}.pdf`;
      // Revoga URL anterior se houver (evita memory leak)
      if (previewPdf?.url) URL.revokeObjectURL(previewPdf.url);
      setPreviewPdf({ url, filename });
    } catch (e) {
      console.error("[ponto] gerar PDF dos lotes falhou:", e);
      alert("Falha ao gerar PDF: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setGerandoPdf(false);
    }
  }

  function fecharPreviewPdf() {
    if (previewPdf?.url) URL.revokeObjectURL(previewPdf.url);
    setPreviewPdf(null);
  }

  function baixarPreviewPdf() {
    if (!previewPdf) return;
    const a = document.createElement("a");
    a.href = previewPdf.url;
    a.download = previewPdf.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function enviarLotePresencial(empregadoId: string) {
    const apontamentos = resolverApontamentosDoLote(empregadoId);
    if (apontamentos.length === 0) {
      alert("Lote vazio.");
      return;
    }
    const empregado = empregados.find((e) => e.id === empregadoId);
    const empregadoNome = empregado?.nome || apontamentos[0].employeeName || "esse empregado";
    if (!window.confirm(`Marcar lote como alinhado presencialmente com ${empregadoNome}?`)) return;
    const ok = await marcarLoteAguardandoAjuste(empregadoId, apontamentos);
    if (ok) await registrarEnvioLocal(empregadoId, "presencial");
  }

  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");

  // Visualização SEMPRE vem dos caches agregados do mês. Filtra ainda pelas
  // semanas selecionadas em `semanasFiltro` (vazio = mês todo).
  const displayedResult: GenerateReportResult | null = useMemo(() => {
    const mesPrefix = `${anoMes.ano}-${pad2(anoMes.mes)}-`;
    let cachesDoMes = todosStatusDoRest.filter(s =>
      s.relatorioCache && (
        (s.weekStart || "").startsWith(mesPrefix) ||
        (s.weekEnd || "").startsWith(mesPrefix)
      )
    );
    if (cachesDoMes.length === 0) return null;
    // Filtro multi-seleção de semanas. Cada chip selecionado adiciona a
    // semana correspondente; vazio = mostra todas.
    if (semanasFiltro.size > 0) {
      const weekStartsAceitos = new Set<string>();
      for (const w of semanasMes) {
        if (semanasFiltro.has(w.index)) weekStartsAceitos.add(w.weekStart);
      }
      cachesDoMes = cachesDoMes.filter(s => weekStartsAceitos.has(s.weekStart));
      if (cachesDoMes.length === 0) return null;
    }
    // Concatena exceptions de todos os caches, filtrando pelo mês.
    // (semanas truncadas podem ter dias do mês anterior/seguinte.)
    const exceptions: ExceptionRecord[] = [];
    const unmatchedMap = new Map<string, { cpf: string; nome: string; dias: number }>();
    let diasAnalisados = 0;
    // Agrega dias analisados por CPF (só dígitos) acumulando entre semanas.
    // Usa Set por cpf pra deduplicar quando 2 semanas se sobrepõem no mesmo
    // dia (não devia acontecer, mas é defensivo).
    const diasAnalisadosPorCpfSet = new Map<string, Set<string>>();
    // Agrega escala efetiva por CPF + data, merging entre semanas. Cache mais
    // RECENTE (geradoEm maior) ganha quando há conflito no mesmo dia — isso
    // garante que regenerar uma semana reflete o estado novo.
    const escalaEfetivaPorCpfAcc = new Map<string, Map<string, { st: ScheduleStatus; geradoEm: string }>>();
    // Mesma lógica do escalaEfetivaPorCpfAcc, mas pra batidas (string formatada).
    const batidasPorCpfAcc = new Map<string, Map<string, { txt: string; geradoEm: string }>>();
    cachesDoMes.forEach(c => {
      const cache = c.relatorioCache;
      if (!cache) return;
      const excs = (cache.exceptions || []) as ExceptionRecord[];
      excs.forEach((e) => {
        if ((e.date || "").startsWith(mesPrefix)) exceptions.push(e);
      });
      const unmatched = (cache.unmatched || []) as Array<{ cpf?: string; nome: string; dias: number }>;
      unmatched.forEach((u) => {
        const k = u.cpf || u.nome;
        const prev = unmatchedMap.get(k);
        if (prev) {
          prev.dias += u.dias;
        } else {
          unmatchedMap.set(k, { cpf: u.cpf || "", nome: u.nome, dias: u.dias });
        }
      });
      diasAnalisados += (cache.diasAnalisados as number | undefined) || 0;
      const diasPorCpf = (cache.diasAnalisadosPorCpf || {}) as Record<string, string[]>;
      for (const [cpf, lista] of Object.entries(diasPorCpf)) {
        const set = diasAnalisadosPorCpfSet.get(cpf) || new Set<string>();
        for (const d of lista) {
          if ((d || "").startsWith(mesPrefix)) set.add(d);
        }
        diasAnalisadosPorCpfSet.set(cpf, set);
      }
      const efetivaPorCpf = (cache.escalaEfetivaPorCpf || {}) as Record<string, Record<string, ScheduleStatus>>;
      const geradoEm = cache.geradoEm || "";
      for (const [cpf, perDate] of Object.entries(efetivaPorCpf)) {
        let m = escalaEfetivaPorCpfAcc.get(cpf);
        if (!m) {
          m = new Map();
          escalaEfetivaPorCpfAcc.set(cpf, m);
        }
        for (const [d, st] of Object.entries(perDate)) {
          if (!(d || "").startsWith(mesPrefix)) continue;
          const prev = m.get(d);
          if (!prev || geradoEm > prev.geradoEm) m.set(d, { st, geradoEm });
        }
      }
      const batidasPorCpf = (cache.batidasPorCpfData || {}) as Record<string, Record<string, string>>;
      for (const [cpf, perDate] of Object.entries(batidasPorCpf)) {
        let m = batidasPorCpfAcc.get(cpf);
        if (!m) {
          m = new Map();
          batidasPorCpfAcc.set(cpf, m);
        }
        for (const [d, txt] of Object.entries(perDate)) {
          if (!(d || "").startsWith(mesPrefix)) continue;
          const prev = m.get(d);
          if (!prev || geradoEm > prev.geradoEm) m.set(d, { txt, geradoEm });
        }
      }
    });
    const diasAnalisadosPorCpf: Record<string, string[]> = {};
    for (const [cpf, set] of diasAnalisadosPorCpfSet) {
      diasAnalisadosPorCpf[cpf] = Array.from(set).sort();
    }
    const escalaEfetivaPorCpf: Record<string, Record<string, ScheduleStatus>> = {};
    for (const [cpf, m] of escalaEfetivaPorCpfAcc) {
      const perDate: Record<string, ScheduleStatus> = {};
      for (const [d, { st }] of m) perDate[d] = st;
      escalaEfetivaPorCpf[cpf] = perDate;
    }
    const batidasPorCpfData: Record<string, Record<string, string>> = {};
    for (const [cpf, m] of batidasPorCpfAcc) {
      const perDate: Record<string, string> = {};
      for (const [d, { txt }] of m) perDate[d] = txt;
      batidasPorCpfData[cpf] = perDate;
    }
    return {
      exceptions,
      unmatched: Array.from(unmatchedMap.values()),
      diasAnalisados,
      diasAnalisadosPorCpf,
      escalaEfetivaPorCpf,
      batidasPorCpfData,
    };
  }, [todosStatusDoRest, anoMes.ano, anoMes.mes, semanasFiltro, semanasMes]);

  // CPFs que ainda constam no quadro do Sólides — do cache MAIS RECENTE do mês
  // (max geradoEm). Não fazemos união entre semanas de propósito: queremos o
  // retrato mais novo do Sólides pra que, ao demitir lá e reatualizar, o
  // alerta suma. Caches antigos sem o campo são ignorados.
  const cpfsAtivosNoSolidesMes = useMemo<Set<string>>(() => {
    const mesPrefix = `${anoMes.ano}-${pad2(anoMes.mes)}-`;
    let melhor: { geradoEm: string; cpfs: string[] } | null = null;
    for (const s of todosStatusDoRest) {
      const cache = s.relatorioCache;
      if (!cache?.cpfsAtivosNoSolides) continue;
      if (!((s.weekStart || "").startsWith(mesPrefix) || (s.weekEnd || "").startsWith(mesPrefix))) continue;
      const geradoEm = cache.geradoEm || "";
      if (!melhor || geradoEm > melhor.geradoEm) melhor = { geradoEm, cpfs: cache.cpfsAtivosNoSolides };
    }
    return new Set((melhor?.cpfs || []).map((c) => (c || "").replace(/\D/g, "")));
  }, [todosStatusDoRest, anoMes.ano, anoMes.mes]);

  // Última atualização agregada do mês ativo — pega o MAX(geradoEm) dos
  // caches cujo weekStart/weekEnd cai no mês visualizado. Alimenta o badge
  // "Última atualização: DD/MM/AAAA HH:mm" exibido logo abaixo dos chips.
  const ultimaAtualizacaoMes = useMemo<string | null>(() => {
    const mesPrefix = `${anoMes.ano}-${pad2(anoMes.mes)}-`;
    let max: string | null = null;
    for (const s of todosStatusDoRest) {
      if (
        !(s.weekStart || "").startsWith(mesPrefix) &&
        !(s.weekEnd || "").startsWith(mesPrefix)
      ) continue;
      const g = s.relatorioCache?.geradoEm;
      if (!g) continue;
      if (max === null || g > max) max = g;
    }
    return max;
  }, [todosStatusDoRest, anoMes.ano, anoMes.mes]);

  // Mês todo = nenhuma semana selecionada (default agora).
  const mesTodo = semanasFiltro.size === 0;
  const [debug, setDebug] = useState<SolidesDebug | null>(null);
  type EscalaDebugInfo = {
    allanId?: string;
    escala?: Record<string, string>;
    sidEncontrado?: number | null;
    cpf?: string;
    quadroSolides?: unknown;
    dateUsedAllan?: string | null;
    totalEmps?: number;
    empsComSchedule?: number;
    empsSemSchedule?: number;
    primeiros5SemSchedule?: string[];
    errosEndpoint?: unknown;
    sampleProbe?: unknown;
    ajustesAplicados?: number;
    sampleProbeAdj?: unknown;
  };
  const [escalaDebug, setEscalaDebug] = useState<EscalaDebugInfo | null>(null);

  // Cobertura Sólides: quais empregados (que batem ponto) ficaram sem
  // quadro Sólides? Banner amarelo aparece pro gestor avisando que
  // esses casos estão sendo avaliados pela escala do Planejamento
  // (fallback) — não pela Sólides como deveriam.
  type CoberturaSolides = {
    semCpf: Array<{ id: string; nome: string }>;        // Planejamento sem CPF
    semMatch: Array<{ id: string; nome: string; cpf: string }>; // CPF não casa na Sólides
    semQuadro: Array<{ id: string; nome: string; cpf: string }>; // tem sid mas sem quadro
    solidesFalhou: boolean; // toda a chamada da API falhou
  };
  const [coberturaSolides, setCoberturaSolides] = useState<CoberturaSolides | null>(null);

  // Carrega empregados do restaurante
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "empregados"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setEmpregados(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Empregado));
    });
    return () => unsub();
  }, [rid]);

  // Pessoas do restaurante — usado pra resolver whatsapp (vive em Pessoa, não
  // em Empregado) e mapear empregadoId → whatsapp pro envio em massa.
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid));
    const unsub = onSnapshot(q, (snap) => {
      setPessoas(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Pessoa));
    });
    return () => unsub();
  }, [rid]);

  const whatsByEmpId = useMemo(() => {
    const pessoaPorId = new Map<string, Pessoa>();
    for (const p of pessoas) pessoaPorId.set(p.id, p);
    const m = new Map<string, string>();
    for (const emp of empregados) {
      const w = emp.pessoaId ? pessoaPorId.get(emp.pessoaId)?.whatsapp : undefined;
      if (w) m.set(emp.id, w);
    }
    return m;
  }, [empregados, pessoas]);

  // Cargos do restaurante — usado pra resolver a ÁREA do empregado (via
  // empregado.cargoId → cargo.area). Permite filtrar o relatório por área pra
  // cada líder ver só a sua.
  const [cargos, setCargos] = useState<Cargo[]>([]);
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "cargos"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setCargos(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Cargo));
    });
    return () => unsub();
  }, [rid]);

  const areaByEmpId = useMemo(() => {
    const cargoPorId = new Map<string, Cargo>();
    for (const c of cargos) cargoPorId.set(c.id, c);
    const m = new Map<string, Area>();
    for (const emp of empregados) {
      const a = cargoPorId.get(emp.cargoId)?.area;
      if (a) m.set(emp.id, a);
    }
    return m;
  }, [empregados, cargos]);

  // Áreas que aparecem nos empregados deste restaurante (pode ter restaurante
  // que não usa todas as 4 padrão). Ordenadas conforme constante AREAS.
  const areasDisponiveis = useMemo(() => {
    const set = new Set<Area>();
    for (const a of areaByEmpId.values()) set.add(a);
    return AREAS.filter((a) => set.has(a));
  }, [areaByEmpId]);

  // Multi-select de áreas. Set vazio = "Todas" (sem filtro). Cada chip
  // alterna inclusão/exclusão.
  const [filtroAreas, setFiltroAreas] = useState<Set<Area>>(new Set());
  function toggleArea(a: Area) {
    setFiltroAreas((cur) => {
      const next = new Set(cur);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });
    // Ao mudar filtro de área, limpa o filtro de empregado — empregado
    // selecionado pode não estar na nova área. Mais previsível.
    setFiltroEmpregados(new Set());
  }

  // Multi-select de empregados. Aparece como linha secundária quando ao menos
  // 1 área está filtrada. Set vazio = "Todos da(s) área(s) filtrada(s)".
  const [filtroEmpregados, setFiltroEmpregados] = useState<Set<string>>(new Set());
  function toggleEmpregado(empId: string) {
    setFiltroEmpregados((cur) => {
      const next = new Set(cur);
      if (next.has(empId)) next.delete(empId);
      else next.add(empId);
      return next;
    });
  }

  // Empregados das áreas filtradas QUE TÊM inconformidade no relatório atual.
  // Esconde dos chips quem não aparece — evita prometer ao líder que ele pode
  // filtrar por X quando X nem está na lista do dia. Usa o relatório bruto
  // (sem o filtro de empregado aplicado), pra não esvaziar o próprio chip
  // selecionado.
  const empregadosFiltraveis = useMemo(() => {
    if (filtroAreas.size === 0) return [];
    if (!displayedResult) return [];
    const comExcecao = new Set<string>();
    for (const exc of displayedResult.exceptions) {
      const cpfD = (exc.cpf || "").replace(/\D/g, "");
      const empId = empIdByCpf.get(cpfD);
      if (empId) comExcecao.add(empId);
    }
    return empregados
      .filter((e) => {
        if (!comExcecao.has(e.id)) return false;
        const area = areaByEmpId.get(e.id);
        return area != null && filtroAreas.has(area);
      })
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [empregados, areaByEmpId, filtroAreas, displayedResult, empIdByCpf]);

  // Texto exibido no botão durante loop "Mês todo"
  const [progressoMes, setProgressoMes] = useState<string | null>(null);

  // gerar() é invocado APENAS pelo loop `atualizarMesTodo` — sempre com uma
  // semana específica (wk) e o status atual dela (pra preservar relatorioCache
  // anterior pro diff "corrigido no Sólides"). Apenas grava o cache em
  // Firestore — o reload de `todosStatusDoRest` no fim do loop atualiza a UI.
  async function gerar(
    wk: SemanaInfo,
    statusSemanaParam: ExcecaoStatusSemana | null,
  ) {
    if (!rid) return;
    const rawSd = wk.weekStart;
    const rawEd = wk.weekEnd;
    // Clampa o fim a HOJE. Sem isso, dias futuros da semana atual
    // (ou semanas inteiras no futuro de um mês ainda em curso) virariam
    // "Falta sem ajuste" porque a escala marca trabalho mas ainda não
    // há punches — daria a impressão de empregado faltando.
    const hoje = todayYmd();
    const sd = rawSd;
    const ed = rawEd > hoje ? hoje : rawEd;
    if (!sd || !ed) return;
    if (sd > ed) return; // Semana inteira no futuro
    try {
      const shortCode = activeRestaurant?.shortCode || "";
      const { punches, debug: dbg } = await fetchPunches(sd, ed, shortCode);

      // Escala vinda da Sólides (fonte primária). Pra cada empregado do
      // Planejamento que tenha CPF, busca o sid Sólides e o quadro do meio
      // do mês — usado como template recorrente pro range todo.
      let escalaPorEmpregado: Record<string, Record<string, import("../../core/types").ScheduleStatus>> = {};
      let horariosPrevistos: Record<string, Record<string, { in: string; out: string }>> = {};
      // CPFs (só dígitos) que ainda têm quadro ATIVO no Sólides nesta geração.
      // Alimenta o apontamento `ativoNoSolidesAposDemissao` (demitido no
      // Planejamento mas ainda no Sólides). Salvo no cache da semana.
      let cpfsAtivosNoSolides: string[] = [];
      const debugInfo: EscalaDebugInfo = {};
      // Acumula cobertura Sólides — banner sumiu junto com a noção de semana
      // ativa, mas mantemos a coleta no caso de querermos exibir agregado
      // depois.
      const cobertura: CoberturaSolides = {
        semCpf: [], semMatch: [], semQuadro: [], solidesFalhou: false,
      };
      try {
        // Várias datas em ordem de prioridade — workaround pro bug da Sólides
        // que às vezes retorna null pra uma data específica mesmo o quadro
        // existindo. Tenta endDate, depois meio, depois startDate, depois hoje.
        const datasTry = [ed, midDate(sd, ed), sd, todayYmd()];
        const schedRes = await fetchSolidesSchedules(datasTry, shortCode);
        const sidByCpf = new Map<string, number>();
        for (const e of schedRes.employees) {
          if (e.cpf) sidByCpf.set(e.cpf, e.id);
        }
        // Quem ainda consta no QUADRO do Sólides = tem schedule não-nulo.
        // (sid sem schedule = bug da API / quadro não atribuído — não conta.)
        cpfsAtivosNoSolides = schedRes.employees
          .filter((e) => e.cpf && schedRes.schedules[String(e.id)] != null)
          .map((e) => onlyDigits(e.cpf));
        const empIdByCpf = new Map<string, string>();
        for (const e of empregados) {
          if (e.cpf) empIdByCpf.set(onlyDigits(e.cpf), e.id);
        }
        escalaPorEmpregado = buildEscalaFromSolides(
          schedRes.schedules, sidByCpf, empIdByCpf, sd, ed,
        );
        // Horários previstos por data (alimenta a regra de atraso)
        horariosPrevistos = buildHorariosPrevistosFromSolides(
          schedRes.schedules, sidByCpf, empIdByCpf, sd, ed,
        );
        // Classifica cobertura — só pra quem bate ponto (cargo "bate ponto").
        // Empregado pode estar em 3 estados problemáticos:
        //   - sem CPF no Planejamento (não dá nem pra tentar match)
        //   - CPF no Planejamento sem match na lista Sólides
        //   - tem sid Sólides mas sem schedule (quadro não atribuído ou bug API)
        const cargoByIdLocal = new Map<string, Cargo>();
        for (const c of (cargos || [])) cargoByIdLocal.set(c.id, c);
        for (const emp of empregados) {
          const cargo = cargoByIdLocal.get(emp.cargoId);
          if (cargo && !empregadoBatePonto(emp, cargo)) continue;
          const cpf = onlyDigits(emp.cpf);
          if (!cpf) { cobertura.semCpf.push({ id: emp.id, nome: emp.nome }); continue; }
          const sid = sidByCpf.get(cpf);
          if (sid == null) { cobertura.semMatch.push({ id: emp.id, nome: emp.nome, cpf }); continue; }
          if (!schedRes.schedules[String(sid)]) {
            cobertura.semQuadro.push({ id: emp.id, nome: emp.nome, cpf });
          }
        }
        // Debug pro Allan + agregados
        const totalEmps = Object.keys(schedRes.schedules).length;
        const empsComSchedule = Object.values(schedRes.schedules).filter((s) => s != null).length;
        const empsSemSchedule = totalEmps - empsComSchedule;
        const primeiros5SemSchedule: string[] = [];
        for (const e of schedRes.employees) {
          if (!schedRes.schedules[String(e.id)] && primeiros5SemSchedule.length < 5) {
            primeiros5SemSchedule.push(`${e.name} (sid ${e.id})`);
          }
        }
        debugInfo.totalEmps = totalEmps;
        debugInfo.empsComSchedule = empsComSchedule;
        debugInfo.empsSemSchedule = empsSemSchedule;
        debugInfo.primeiros5SemSchedule = primeiros5SemSchedule;
        debugInfo.errosEndpoint = schedRes.errors;
        debugInfo.sampleProbe = schedRes.sampleProbe;

        const allan = empregados.find((e) => e.nome.toLowerCase().includes("allan"));
        if (allan) {
          const cpf = onlyDigits(allan.cpf);
          const sid = cpf ? sidByCpf.get(cpf) : undefined;
          debugInfo.allanId = allan.id;
          debugInfo.cpf = cpf;
          debugInfo.sidEncontrado = sid ?? null;
          debugInfo.quadroSolides = sid != null ? schedRes.schedules[String(sid)] : null;
          debugInfo.dateUsedAllan = sid != null && schedRes.dateUsed ? schedRes.dateUsed[String(sid)] : null;
          debugInfo.escala = escalaPorEmpregado[allan.id]
            ? Object.fromEntries(Object.entries(escalaPorEmpregado[allan.id]))
            : undefined;
        }
      } catch (e) {
        console.warn("Sólides schedules falhou, usando fallback do Planejamento:", e);
        cobertura.solidesFalhou = true;
      }
      setCoberturaSolides(cobertura);

      // Fallback / merge: pra empregados que NÃO tiveram escala vinda da
      // Sólides (sem CPF, sem quadro), usa a escala do Planejamento.
      const fallback = await buildEscalaContext(empregados, rid, sd, ed);
      for (const [empId, perDate] of Object.entries(fallback)) {
        if (!escalaPorEmpregado[empId]) {
          escalaPorEmpregado[empId] = perDate;
        }
      }

      // Ajustes aprovados (FOLGA, ATESTADO, ABONO, FÉRIAS, etc) sobrescrevem
      // dias da escala oficial pra "folga" — evita falsos positivos de "Falta
      // sem ajuste" em dias em que o RH justificou ausência. Falta NÃO
      // justificada é deixada como "trabalho" pra a regra continuar disparando.
      // Captura o índice {empId: {date: {tipo, statusAnterior}}} pra
      // alimentar a regra `faltaJustificadaSolides` (mostra "✓ Justificado"
      // em vez do dia simplesmente sumir do relatório).
      let ajustesAplicadosPorEmpId: Awaited<ReturnType<typeof aplicarAjustesNaEscala>>["ajustesAplicados"] = {};
      try {
        const [y1, m1, d1] = sd.split("-").map(Number);
        const [y2, m2, d2] = ed.split("-").map(Number);
        // Expande o startDate em 90 dias pra trás pra capturar ajustes longos
        // (férias de 30d, atestados longos, afastamentos) que COMEÇARAM antes
        // do range mas cobrem dias dentro dele. A API Sólides parece filtrar
        // por `adjustment.startDate IN range` (não overlap), então sem essa
        // expansão um ajuste de férias começando em 21/05 não retorna pra
        // semana 25–31/05. O `aplicarAjustesNaEscala` ignora dias fora do
        // range visualizado (perDate[d] só existe pros dias da escala).
        const startMs = Date.UTC(y1, m1 - 1, d1 - 90, 0, 0, 0, 0);
        const endMs   = Date.UTC(y2, m2 - 1, d2, 23, 59, 59, 999);
        const adjRes = await fetchSolidesAdjustments(startMs, endMs, shortCode);
        // mapa empregadoId Planejamento → sid Sólides
        const sidByCpfMap = new Map<string, number>();
        for (const e of adjRes.employees) {
          if (e.cpf) sidByCpfMap.set(e.cpf, e.id);
        }
        const sidByEmpId: Record<string, number> = {};
        const naoMapeados: { id: string; nome: string; cpf: string }[] = [];
        for (const emp of empregados) {
          const c = onlyDigits(emp.cpf);
          const sid = c ? sidByCpfMap.get(c) : undefined;
          if (sid != null) {
            sidByEmpId[emp.id] = sid;
          } else {
            naoMapeados.push({ id: emp.id, nome: emp.nome, cpf: c });
          }
        }
        // eslint-disable-next-line no-console
        console.log("[DEBUG sidByEmpId mapping]", {
          totalEmpregadosPlanejamento: empregados.length,
          totalEmpregadosSolides: adjRes.employees.length,
          totalMapeados: Object.keys(sidByEmpId).length,
          naoMapeados,
          sampleSolidesEmployees: adjRes.employees.slice(0, 10),
        });
        const aplicarRes = aplicarAjustesNaEscala(adjRes.adjustments, sidByEmpId, escalaPorEmpregado);
        ajustesAplicadosPorEmpId = aplicarRes.ajustesAplicados;
        debugInfo.ajustesAplicados = adjRes.count;
        debugInfo.sampleProbeAdj = adjRes.sampleProbe;

        // 2º caminho: afastamentos lançados pelo módulo "Afastamento" (UI
        // nova da Sólides — atestado óbito, licença, etc). Tem API separada
        // com tokens próprios (env SOLIDES_TIMEOFFWORK_TOKENS). Falha
        // silenciosa se não configurado — o fluxo dos ajustes antigos
        // continua funcionando.
        try {
          const leavesRes = await fetchSolidesLeaves(shortCode);
          if (leavesRes.error) {
            console.warn("Sólides leaves não configurado/erro:", leavesRes.error);
          } else if (leavesRes.leaves.length > 0) {
            const aplicarLeaves = aplicarAfastamentosNaEscala(
              leavesRes.leaves, sidByEmpId, escalaPorEmpregado,
            );
            // Merge: afastamentos sobrepõem ajustes do mesmo dia (raro)
            for (const [empId, perDate] of Object.entries(aplicarLeaves.ajustesAplicados)) {
              if (!ajustesAplicadosPorEmpId[empId]) ajustesAplicadosPorEmpId[empId] = {};
              Object.assign(ajustesAplicadosPorEmpId[empId], perDate);
            }
            // eslint-disable-next-line no-console
            console.log("[DEBUG afastamentos]", {
              total: leavesRes.count,
              aplicados: aplicarLeaves.aplicados,
              sampleProbe: leavesRes.sampleProbe,
            });
          }
        } catch (e) {
          console.warn("Sólides leaves falhou (seguindo sem afastamentos):", e);
        }
        // DEBUG: log focado em empregados específicos pra investigar
        // por que ajustes (atestado, óbito) não estão sendo aplicados.
        // CPFs de interesse passados via filtro: Larissa, Joyce, etc.
        const cpfsFoco = ["08972703206"]; // Larissa Fabiele
        for (const cpfFoco of cpfsFoco) {
          const empFoco = empregados.find(e => onlyDigits(e.cpf) === cpfFoco);
          if (!empFoco) continue;
          const sidFoco = sidByEmpId[empFoco.id];
          const ajsFoco = sidFoco ? adjRes.adjustments[String(sidFoco)] : undefined;
          const ajsAplicadosFoco = aplicarRes.ajustesAplicados[empFoco.id];
          const escalaFoco = escalaPorEmpregado[empFoco.id];
          // eslint-disable-next-line no-console
          console.log(`[DEBUG ajuste foco] ${empFoco.nome}`, {
            empId: empFoco.id,
            sidFoco,
            qtdAjustesAPI: ajsFoco?.length || 0,
            ajustesNaAPI: ajsFoco?.map(a => ({
              tipo: a.type || a.reason,
              status: a.status,
              startDate: a.startDate,
              endDate: a.endDate,
            })),
            ajustesAplicados: ajsAplicadosFoco,
            escalaJanela: escalaFoco && Object.keys(escalaFoco).sort().reduce((acc: Record<string, unknown>, k) => {
              acc[k] = escalaFoco[k]; return acc;
            }, {}),
          });
        }
      } catch (e) {
        console.warn("Sólides adjustments falhou:", e);
      }

      // Atualiza debug — pega a escala FINAL (depois do merge) pro Allan
      const allanFinal = empregados.find((e) => e.nome.toLowerCase().includes("allan"));
      if (allanFinal && escalaPorEmpregado[allanFinal.id]) {
        debugInfo.escala = Object.fromEntries(Object.entries(escalaPorEmpregado[allanFinal.id]));
      }
      setEscalaDebug(debugInfo);

      const report = generateExceptionsReport({
        punches,
        empregados,
        cargos,
        escalaPorEmpregado,
        horariosPrevistos,
        ajustesAplicadosPorEmpId,
        startDate: sd,
        endDate: ed,
      });
      setDebug(dbg || null);

      // Salva o snapshot no doc da semana SEMPRE — assim o líder pode gerar,
      // sair, e voltar depois sem perder o que já tinha visto.
      // Antes de sobrescrever o cache, captura o snapshot anterior pra
      // diff "corrigido no Sólides" (#194).
      const antesSnap = statusSemanaParam?.relatorioCache?.exceptions || [];
      try {
        await salvarRelatorioCache(
          rid,
          wk.weekStart,
          wk.weekEnd,
          {
            geradoEm: new Date().toISOString(),
            exceptions: report.exceptions,
            unmatched: report.unmatched,
            diasAnalisados: report.diasAnalisados,
            diasAnalisadosPorCpf: report.diasAnalisadosPorCpf,
            // Escala efetiva pós-ajustes — usado pela UI pra listar todos os
            // dias do mês por empregado, não só os com exception. Caches
            // antigos sem esse campo caem no modo legado (só dias com exc +
            // dias verdes via diasAnalisadosPorCpf).
            escalaEfetivaPorCpf: report.escalaEfetivaPorCpf,
            // Batidas formatadas por CPF → data, mesmo nos dias sem
            // inconformidade. UI usa pra mostrar "Trabalhou normal · 📍 E1 ... S2 ...".
            batidasPorCpfData: report.batidasPorCpfData,
            // Roster do quadro Sólides desta geração — alimenta o alerta de
            // demitido-ainda-no-Sólides no merge mensal (displayedResult).
            cpfsAtivosNoSolides,
          },
          me || undefined,
        );

        // F2 — Atrasos automáticos: pra cada atrasoEntrada, grava
        // marcador na escala + cria evento ponto_atraso na Trilha.
        if (me) {
          try {
            const { processarAtrasos } = await import("../../core/excecoes/atrasos");
            const r = await processarAtrasos({
              restaurantId: rid,
              excecoes: report.exceptions,
              empIdByCpf,
              por: { id: me.id, nome: me.nome },
            });
            if (r.novos > 0) {
              console.log(`[ponto] ${r.novos} atraso(s) registrado(s) na escala + Trilha`);
            }
          } catch (e) {
            console.warn("[ponto] falha ao processar atrasos:", e);
          }
        }

        // F6 — Detecção retroativa de ajuste manual na escala:
        // se o líder já mudou o status da praticada (ex: marcou "ferias")
        // sem usar o botão "Resolver na escala", marca o apontamento
        // como ciência automaticamente.
        if (me) {
          try {
            await detectarAjustesManuaisRetroativos({
              rid,
              weekStart: wk.weekStart,
              weekEnd: wk.weekEnd,
              excecoes: report.exceptions,
              empIdByCpf,
              statusSemanaAtual: statusSemanaParam,
              me,
            });
          } catch (e) {
            console.warn("[ponto] falha na detecção retroativa:", e);
          }
        }

        // Diff "corrigido no Sólides": tudo que estava no antesSnap e
        // não está no novo report vira "corrigido_solides".
        if (antesSnap.length > 0 && me) {
          const { marcarCorrigidosNoSolides } = await import("../../core/excecoes/statusDia");
          const r = await marcarCorrigidosNoSolides({
            restaurantId: rid,
            excecoesAntes: (antesSnap as Array<{ cpf: string; date: string }>).map(e => ({ cpf: e.cpf, date: e.date })),
            excecoesDepois: report.exceptions.map(e => ({ cpf: e.cpf, date: e.date })),
            empIdByCpf,
            por: { id: me.id, nome: me.nome },
          });
          if (r.marcados > 0) {
            console.log(`[ponto] ${r.marcados} dia(s) marcado(s) como corrigido_solides`);
          }
        }
      } catch (e) {
        console.error("Erro salvando cache do relatório:", e);
        throw e;
      }
    } catch (e) {
      // Loop "Mês todo" — joga pro chamador agregar falhas
      throw e;
    }
  }

  // Atualiza UM dia de UM empregado. Bem mais rápido que mês inteiro —
  // só faz fetch de punches do dia (1 página, sub-segundo) + quadro Sólides
  // do empregado (1 call). Mergea no cache da semana correspondente sem
  // tocar nos outros dias/empregados. Útil depois de o empregado corrigir
  // um ponto na Sólides — o líder valida em 1-2s em vez de 10-20s.
  // Set de keys "refresh:<empId>_<date>" em salvandoApontamento pra UI.
  async function atualizarUmDia(empregadoId: string, date: string) {
    if (!rid || !me) return;
    const lockKey = `refresh:${empregadoId}_${date}`;
    setSalvandoApontamento((prev) => new Set(prev).add(lockKey));
    try {
      const wk = semanaInfoParaData(date);
      if (!wk) {
        alert("Sem semana correspondente pra essa data.");
        return;
      }
      const cacheSemana = todosStatusDoRest.find((s) => s.weekStart === wk.weekStart);
      const cache = cacheSemana?.relatorioCache;
      if (!cache) {
        alert("Sem cache da semana — gere o relatório do mês primeiro (botão 🔄 Atualizar).");
        return;
      }
      const emp = empregados.find((e) => e.id === empregadoId);
      if (!emp) {
        alert("Empregado não encontrado.");
        return;
      }
      const cpfD = onlyDigits(emp.cpf || "");
      if (!cpfD) {
        alert("Empregado sem CPF — não dá pra casar com Sólides.");
        return;
      }

      const shortCode = activeRestaurant?.shortCode || "";
      // 1) Punches só desse dia (1 página)
      const { punches } = await fetchPunches(date, date, shortCode);
      const punchesDoEmp = punches.filter((p) => {
        const cpfPunch = onlyDigits(p.employee?.cpf || "");
        return cpfPunch === cpfD;
      });

      // 2) Escala efetiva DESSE dia — pega do cache atual (Plan já foi
      // computado quando o mês foi gerado; só re-aplicar se a escala mudou,
      // mas isso é caso raro pra "atualizar este dia").
      const efetivaCache = (cache.escalaEfetivaPorCpf || {}) as Record<string, Record<string, ScheduleStatus>>;
      const stDoDia = efetivaCache[cpfD]?.[date];
      const escalaInput: Record<string, Record<string, ScheduleStatus>> = {};
      if (stDoDia) escalaInput[emp.id] = { [date]: stDoDia };
      // 3) Horário previsto Sólides (re-fetch fresco pra esse dia)
      const horariosInput: Record<string, Record<string, { in: string; out: string }>> = {};
      try {
        const schedRes = await fetchSolidesSchedules([date], shortCode);
        const sidByCpf = new Map<string, number>();
        for (const e of schedRes.employees) {
          if (e.cpf) sidByCpf.set(onlyDigits(e.cpf), e.id);
        }
        const sid = sidByCpf.get(cpfD);
        if (sid != null) {
          const sched = schedRes.schedules[String(sid)];
          if (sched) {
            const dow = new Date(date + "T12:00:00").getDay();
            const d = sched.byDay[dow];
            if (d?.active) {
              horariosInput[emp.id] = { [date]: { in: d.in, out: d.out } };
            }
          }
        }
      } catch (e) {
        console.warn("[ponto] fetchSolidesSchedules pro dia falhou (seguindo sem):", e);
      }

      // 4) Roda o motor de regras só pra esse dia/empregado
      const result = generateExceptionsReport({
        punches: punchesDoEmp,
        empregados: [emp],
        cargos,
        escalaPorEmpregado: escalaInput,
        horariosPrevistos: horariosInput,
        startDate: date,
        endDate: date,
      });

      // 5) Merge no cache da semana — substitui só (cpf, date)
      const exceptionsCache = (cache.exceptions || []) as ExceptionRecord[];
      const filtradas = exceptionsCache.filter(
        (e) => !(onlyDigits(e.cpf || "") === cpfD && e.date === date),
      );
      const novasExceptions = [...filtradas, ...result.exceptions];

      // Atualiza batidasPorCpfData
      const batidasCacheNovo: Record<string, Record<string, string>> = {
        ...((cache.batidasPorCpfData || {}) as Record<string, Record<string, string>>),
      };
      batidasCacheNovo[cpfD] = { ...(batidasCacheNovo[cpfD] || {}) };
      const batidasNova = result.batidasPorCpfData[cpfD]?.[date];
      if (batidasNova) batidasCacheNovo[cpfD][date] = batidasNova;
      else delete batidasCacheNovo[cpfD][date];

      await salvarRelatorioCache(rid, wk.weekStart, wk.weekEnd, {
        ...cache,
        geradoEm: new Date().toISOString(),
        exceptions: novasExceptions,
        batidasPorCpfData: batidasCacheNovo,
      }, me);
      await recarregarCaches();
    } catch (e) {
      console.error("[ponto] atualizarUmDia falhou:", e);
      alert("Falha ao atualizar este dia: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSalvandoApontamento((prev) => {
        const next = new Set(prev);
        next.delete(lockKey);
        return next;
      });
    }
  }

  // Atualiza pela Sólides TODAS as semanas do mês ativo, em sequência.
  // Usado quando o usuário está em "Mês todo" e clica "🔄 Atualizar" —
  // antes esse botão regenerava só a 1ª semana (fallback de semanaAtiva).
  async function atualizarMesTodo() {
    if (!rid || semanasMes.length === 0) return;
    setLoading(true);
    setErro("");
    const falhas: Array<{ semana: string; motivo: string }> = [];
    const hoje = todayYmd();
    // Filtra semanas que JÁ COMEÇARAM. Semanas inteiramente no futuro
    // geram falsas "Falta sem ajuste" porque a escala marca trabalho
    // mas ainda não há punches — daria a impressão de que o empregado
    // não bateu ponto em vários dias. Semana que contém hoje passa
    // (será clampada via endDate ≤ hoje dentro do gerar).
    const semanasParaAtualizar = semanasMes.filter(w => w.weekStart <= hoje);
    if (semanasParaAtualizar.length === 0) {
      setLoading(false);
      setErro("Esse mês ainda não começou — nada a atualizar.");
      return;
    }
    try {
      // Carrega caches atuais 1x pra alimentar `statusSemanaParam` no `gerar`
      // (preserva o snapshot anterior pro diff "corrigido no Sólides").
      let cachesAtuais: ExcecaoStatusSemana[] = [];
      try {
        cachesAtuais = await listarStatusDoRestaurante(rid);
      } catch (e) {
        console.warn("[ponto] falha ao carregar caches antes do loop:", e);
      }
      for (let i = 0; i < semanasParaAtualizar.length; i++) {
        const w = semanasParaAtualizar[i];
        // Clampa o endDate a hoje pra não gerar inconformidade em dia
        // que ainda não chegou (semana atual).
        const wClamp: SemanaInfo = w.weekEnd > hoje ? { ...w, weekEnd: hoje } : w;
        setProgressoMes(`${i + 1}/${semanasParaAtualizar.length}`);
        try {
          const st = cachesAtuais.find(s => s.weekStart === w.weekStart) || null;
          await gerar(wClamp, st);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[ponto] falha na semana ${w.weekStart}:`, e);
          falhas.push({ semana: w.label, motivo: msg });
        }
      }
      // Recarrega os caches do mês pra o displayedResult agregar tudo
      try {
        const rows = await listarStatusDoRestaurante(rid);
        setTodosStatusDoRest(rows);
      } catch (e) {
        console.warn("[ponto] falha ao recarregar caches:", e);
      }
      if (falhas.length > 0) {
        setErro(
          `Sólides falhou em ${falhas.length}/${semanasMes.length} semana(s): ` +
          falhas.map(f => `${f.semana} (${f.motivo})`).join("; ") +
          ". Tente atualizar essas semanas individualmente.",
        );
      }
    } finally {
      setProgressoMes(null);
      setLoading(false);
    }
  }

  // Exceções após aplicar filtros (área + empregado, multi-select). Sets
  // vazios = "todos". Filtro de empregado só age quando ao menos 1 está
  // selecionado.
  const excecoesFiltradas = useMemo(() => {
    if (!displayedResult) return [];
    if (filtroAreas.size === 0 && filtroEmpregados.size === 0) return displayedResult.exceptions;
    return displayedResult.exceptions.filter((e) => {
      // Resolve área pelo CPF → empregadoId Planejamento → área do cargo.
      const cpfD = (e.cpf || "").replace(/\D/g, "");
      const empId = empIdByCpf.get(cpfD);
      if (filtroAreas.size > 0) {
        const area = empId ? areaByEmpId.get(empId) : undefined;
        if (area == null || !filtroAreas.has(area)) return false;
      }
      if (filtroEmpregados.size > 0) {
        if (!empId || !filtroEmpregados.has(empId)) return false;
      }
      return true;
    });
  }, [displayedResult, filtroAreas, filtroEmpregados, areaByEmpId, empIdByCpf]);

  // Base de empregados pra listar como "blocos de empregado" — só os que
  // batem ponto, dentro dos filtros de área/empregado. Memoizada porque
  // alimenta a montagem de DayRows (potencial N × M).
  const basePessoas = useMemo(() => {
    const cargoById = new Map<string, Cargo>();
    for (const c of cargos) cargoById.set(c.id, c);
    return empregados
      .filter((emp) => {
        const cargo = cargoById.get(emp.cargoId);
        // Só lista os que batem ponto (helper já considera tipoVinculo +
        // override individual + override de cargo).
        if (!empregadoBatePonto(emp, cargo)) return false;
        if (filtroAreas.size > 0) {
          const area = areaByEmpId.get(emp.id);
          if (area == null || !filtroAreas.has(area)) return false;
        }
        if (filtroEmpregados.size > 0) {
          if (!filtroEmpregados.has(emp.id)) return false;
        }
        return true;
      })
      .map((emp) => ({
        id: emp.id,
        nome: emp.nome,
        cpf: emp.cpf || "",
        admissao: emp.admissaoAtual || null,
        demissao: emp.demitidoEm || null,
      }));
  }, [empregados, cargos, filtroAreas, filtroEmpregados, areaByEmpId]);

  // Dias do mês ativo até hoje (sem futuro), filtrados pelas semanas
  // selecionadas se houver. Compartilhado entre todos os blocos.
  const diasDoMes = useMemo(() => {
    const todos = diasDoMesAteHoje(anoMes.ano, anoMes.mes, todayYmd());
    if (semanasFiltro.size === 0) return todos;
    return todos.filter((d) =>
      semanasMes.some(
        (w) => semanasFiltro.has(w.index) && w.weekStart <= d && w.weekEnd >= d,
      ),
    );
  }, [anoMes.ano, anoMes.mes, semanasFiltro, semanasMes]);

  // Injeta os apontamentos sintéticos de "demitido ainda no Sólides".
  // É um alerta administrativo permanente (não tem batida/dia próprio), então
  // ancoramos numa data visível: a própria data de demissão quando ela cai no
  // mês (a vista completa mantém o dia da demissão), senão o último dia visível
  // (modo legado renderiza pela data do apontamento). Some sozinho quando o CPF
  // sai do quadro do Sólides (não entra mais em cpfsAtivosNoSolidesMes).
  const excecoesComDemitidos = useMemo<ExceptionRecord[]>(() => {
    const base = excecoesFiltradas;
    if (cpfsAtivosNoSolidesMes.size === 0 || basePessoas.length === 0) return base;
    const hoje = todayYmd();
    const monthStart = `${anoMes.ano}-${pad2(anoMes.mes)}-01`;
    const ultimoVisivel = diasDoMes.length ? diasDoMes[diasDoMes.length - 1] : hoje;
    const extras: ExceptionRecord[] = [];
    for (const p of basePessoas) {
      if (!p.demissao || p.demissao > hoje) continue; // só quem já saiu
      const cpfD = (p.cpf || "").replace(/\D/g, "");
      if (!cpfD || !cpfsAtivosNoSolidesMes.has(cpfD)) continue;
      const anchor =
        p.demissao >= monthStart && p.demissao <= ultimoVisivel ? p.demissao : ultimoVisivel;
      extras.push({
        ruleId: "ativoNoSolidesAposDemissao",
        severity: "grave",
        date: anchor,
        employeeId: 0,
        cpf: p.cpf,
        employeeName: p.nome,
        description: `Demitido no Planejamento em ${fmtDataBr(p.demissao)}, mas ainda consta no quadro do Sólides — desligar lá (continua contando/cobrando).`,
      });
    }
    return extras.length ? [...base, ...extras] : base;
  }, [excecoesFiltradas, basePessoas, cpfsAtivosNoSolidesMes, diasDoMes, anoMes.ano, anoMes.mes]);

  // Grupos calculados — memoizado pra evitar refazer o trabalho a cada toggle
  // de expansão. Depende de tudo que alimenta render.
  const grupos = useMemo(() => {
    if (!displayedResult) return [];
    return agruparPorColabDate(
      excecoesComDemitidos,
      empIdByCpf,
      basePessoas,
      displayedResult.escalaEfetivaPorCpf || {},
      diasDoMes,
      apontamentosPorChave,
      statusApontamentoMap,
      statusDiaMap,
    );
  }, [
    displayedResult,
    excecoesComDemitidos,
    empIdByCpf,
    basePessoas,
    diasDoMes,
    apontamentosPorChave,
    statusApontamentoMap,
    statusDiaMap,
  ]);

  return (
    <div>
      {/* ── Seleção de semana + ação ── */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4 space-y-3">
        {/* Navegação de mês */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navegaMes(-1)}
              aria-label="Mês anterior"
              className="text-lg leading-none px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
            >←</button>
            <div className="font-semibold text-sm text-gray-800 dark:text-gray-100 capitalize min-w-[140px] text-center">
              {new Date(anoMes.ano, anoMes.mes - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
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
                setSemanasFiltro(new Set());
              }}
              className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline ml-1"
            >hoje</button>
          </div>
        </div>

        {/* Chips de semana — filtro multi-seleção pra visualização.
            Vazio = mês todo (default). Click adiciona/remove do filtro.
            O botão final "🔄 Atualizar" sempre regenera o mês todo. */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {semanasMes.map((w) => {
            const ativo = semanasFiltro.has(w.index);
            return (
              <button
                key={w.index}
                type="button"
                onClick={() =>
                  setSemanasFiltro((prev) => {
                    const next = new Set(prev);
                    if (next.has(w.index)) next.delete(w.index);
                    else next.add(w.index);
                    return next;
                  })
                }
                className={`text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full transition-colors ${
                  ativo
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                } ${w.containsToday && !ativo ? "ring-1 ring-indigo-400 dark:ring-indigo-500" : ""}`}
                title={`${w.weekStart} a ${w.weekEnd}${ativo ? " — clique pra remover do filtro" : " — clique pra filtrar"}`}
              >
                {w.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => void atualizarMesTodo()}
            disabled={loading || empregados.length === 0}
            className="ml-auto text-[11px] uppercase tracking-wider font-semibold px-3 py-1 rounded-full transition-colors bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title="Atualizar todas as semanas do mês pela Sólides (1 por vez)"
          >
            {loading
              ? (progressoMes ? `⏳ ${progressoMes}…` : "⏳ atualizando…")
              : "🔄 Atualizar"}
          </button>
        </div>

        {ultimaAtualizacaoMes ? (
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
            Última atualização: <span className="tabular-nums">{fmtBRDateTime(ultimaAtualizacaoMes)}</span>
          </div>
        ) : (
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 italic">
            Nunca atualizado neste mês
          </div>
        )}

        {empregados.length === 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Nenhum empregado cadastrado neste restaurante — cadastre em Pessoas pra poder casar as
            marcações.
          </p>
        )}
      </div>

      {erro && (
        <div className="rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3 text-sm text-rose-800 dark:text-rose-300 mb-4">
          ❌ {erro}
        </div>
      )}

      {loading && (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Consultando a Sólides e cruzando com a escala...
        </div>
      )}

      {/* ── Painel de debug (só master) ── */}
      {me?.isMaster && debug && (
        <details className="mb-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 select-none">
            🛠️ Debug API Sólides (só master)
          </summary>
          <div className="px-3 py-2 text-[11px] space-y-1.5 text-gray-700 dark:text-gray-300 font-mono">
            <div>📦 <strong>{debug.pages.count}</strong> página(s) consultada(s) — tamanhos: [{debug.pages.sizes.join(", ")}]</div>
            <div>📊 Total reportado: <strong>{debug.totalElementsReported}</strong> · Raw: <strong>{debug.raw}</strong> · Após dedupe+range: <strong>{debug.dedupedTotal}</strong> · Duplicatas: <strong className={debug.duplicatesRemoved > 0 ? "text-rose-600" : ""}>{debug.duplicatesRemoved}</strong>{typeof debug.outOfRange === "number" && (<> · Fora do range: <strong className={debug.outOfRange > 0 ? "text-amber-600" : ""}>{debug.outOfRange}</strong></>)}</div>
            <div>🏷️ Flags: excluded={debug.flags.excluded} · edited={debug.flags.edited} · com adjustment={debug.flags.withAdjustment}</div>
            {debug.responsesMeta && (
              <div>📑 Respostas da Sólides: {debug.responsesMeta.map((r, i) => (
                <span key={i} className="ml-1">[pedido={r.requested}, number={r.number ?? "—"}, last={String(r.last)}, totalPages={r.totalPages ?? "—"}, size={r.size}]</span>
              ))}</div>
            )}
            {escalaDebug && (
              <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                <div>📊 Empregados: total=<strong>{escalaDebug.totalEmps}</strong> · com schedule=<strong className="text-emerald-700">{escalaDebug.empsComSchedule}</strong> · SEM schedule=<strong className={escalaDebug.empsSemSchedule && escalaDebug.empsSemSchedule > 0 ? "text-rose-600" : ""}>{escalaDebug.empsSemSchedule}</strong></div>
                {escalaDebug.primeiros5SemSchedule && escalaDebug.primeiros5SemSchedule.length > 0 && (
                  <div className="text-[10px] text-gray-500">Primeiros sem schedule: {escalaDebug.primeiros5SemSchedule.join(" · ")}</div>
                )}
                {Array.isArray(escalaDebug.errosEndpoint) && (escalaDebug.errosEndpoint as unknown[]).length > 0 && (
                  <div className="text-[10px] text-rose-600">⚠ Erros endpoint: <pre className="inline whitespace-pre-wrap break-all">{JSON.stringify(escalaDebug.errosEndpoint).slice(0, 500)}</pre></div>
                )}
                {escalaDebug.sampleProbe ? (
                  <div className="text-[10px] mt-1 text-amber-700">🔍 Amostra Sólides: <pre className="inline whitespace-pre-wrap break-all">{JSON.stringify(escalaDebug.sampleProbe)}</pre></div>
                ) : null}
                {typeof escalaDebug.ajustesAplicados === "number" && (
                  <div className="text-[10px] mt-1 text-emerald-700">🏷️ Ajustes aplicados: <strong>{escalaDebug.ajustesAplicados}</strong></div>
                )}
                {escalaDebug.sampleProbeAdj ? (
                  <div className="text-[10px] mt-1 text-amber-700">🔍 Amostra Ajuste: <pre className="inline whitespace-pre-wrap break-all">{JSON.stringify(escalaDebug.sampleProbeAdj)}</pre></div>
                ) : null}
                <div className="mt-1">🧪 Allan: empId=<strong>{escalaDebug.allanId || "—"}</strong> · cpf=<strong>{escalaDebug.cpf || "—"}</strong> · sid Sólides=<strong>{escalaDebug.sidEncontrado ?? "—"}</strong> · dateUsed=<strong>{escalaDebug.dateUsedAllan || "—"}</strong></div>
                <div>📅 Escala final (após merge):</div>
                <div className="grid grid-cols-3 md:grid-cols-5 gap-x-3 gap-y-0.5 text-[10px]">
                  {escalaDebug.escala && Object.entries(escalaDebug.escala).sort((a, b) => a[0].localeCompare(b[0])).map(([d, st]) => (
                    <div key={d} className="tabular-nums">
                      <span className="text-gray-500">{d}</span> · <strong className={st === "folga" ? "text-blue-600" : st === "trabalho" ? "text-emerald-700" : ""}>{st}</strong>
                    </div>
                  ))}
                </div>
                <div className="mt-1">📜 Quadro raw da Sólides pro Allan: <pre className="inline whitespace-pre-wrap break-all text-[10px]">{JSON.stringify(escalaDebug.quadroSolides)}</pre></div>
              </div>
            )}
            <div className="mt-2">
              <div className="text-gray-500 dark:text-gray-400 mb-1">Punches por (data, empregadoId Sólides):</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-0.5 text-[10px]">
                {Object.entries(debug.perDateEmployee)
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([k, v]) => (
                    <div key={k} className="tabular-nums">
                      <span className="text-gray-500">{k}</span> · <strong>{v}</strong>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </details>
      )}

      {displayedResult && !loading && (
        <>
          {/* ── Aviso de não-casados ── */}
          {displayedResult.unmatched.length > 0 && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-300 mb-4">
              <strong>
                ⚠ {displayedResult.unmatched.length} colaborador(es) da Sólides sem empregado correspondente
                no Planejamento
              </strong>{" "}
              (CPF não bateu). As marcações deles foram ignoradas:
              <ul className="mt-1 ml-4 list-disc text-xs">
                {displayedResult.unmatched.slice(0, 10).map((u) => (
                  <li key={u.cpf || u.nome}>
                    {u.nome} {u.cpf ? `(CPF ${u.cpf})` : "(sem CPF na Sólides)"} — {u.dias} dia(s)
                  </li>
                ))}
                {displayedResult.unmatched.length > 10 && <li>… e mais {displayedResult.unmatched.length - 10}</li>}
              </ul>
            </div>
          )}

          {/* ── Filtro de áreas (multi-select). 1º botão "Todas" limpa o
              set; demais são toggles cumulativos. Botão de PDF alinhado
              à direita. ── */}
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            <button
              type="button"
              onClick={() => {
                setFiltroAreas(new Set());
                // Voltar pra "Todas" também limpa o filtro de empregado —
                // chips de empregado somem quando não há área filtrada,
                // o Set residual filtraria silenciosamente o relatório.
                setFiltroEmpregados(new Set());
              }}
              className={`text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full transition-colors ${
                filtroAreas.size === 0
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
              title="Mostrar todas as áreas"
            >
              Todas
            </button>
            {areasDisponiveis.map((a) => {
              const ativo = filtroAreas.has(a);
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => toggleArea(a)}
                  className={`text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full transition-colors ${
                    ativo
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                  title={ativo ? `Remover ${a} do filtro` : `Adicionar ${a} ao filtro`}
                >
                  {a}
                </button>
              );
            })}
            {/* Botão de PDF — consolida todos os lotes abertos +
                apontamentos marcados como "empresa resolverá". */}
            {(() => {
              const temEmpresaAjustara = Array.from(statusApontamentoMap.values())
                .some(d => d.status === "empresa_ajustara");
              const podeGerar = lotesDocs.size > 0 || temEmpresaAjustara;
              return (
                <button
                  type="button"
                  onClick={() => void gerarPdfLotes()}
                  disabled={!podeGerar || gerandoPdf}
                  className={`ml-auto text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors whitespace-nowrap ${
                    !podeGerar || gerandoPdf
                      ? "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed"
                      : "bg-rose-600 text-white hover:bg-rose-700 shadow-sm"
                  }`}
                  title={
                    !podeGerar
                      ? "Sem nenhum lote aberto e nenhum item marcado como 'empresa resolverá'"
                      : "Gera PDF com pedidos pro empregado + lista pra empresa resolver direto na Sólides"
                  }
                >
                  {gerandoPdf ? "⏳ Gerando…" : "📄 Gerar PDF"}
                </button>
              );
            })()}
          </div>

          {/* ── Filtro de empregados — só aparece quando 1+ área filtrada.
              Mostra os empregados das áreas filtradas (multi-select). ── */}
          {empregadosFiltraveis.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <button
                type="button"
                onClick={() => setFiltroEmpregados(new Set())}
                className={`text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full transition-colors ${
                  filtroEmpregados.size === 0
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
                title="Mostrar todos da(s) área(s) filtrada(s)"
              >
                Todos
              </button>
              {empregadosFiltraveis.map((emp) => {
                const ativo = filtroEmpregados.has(emp.id);
                return (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => toggleEmpregado(emp.id)}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors whitespace-nowrap ${
                      ativo
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                    }`}
                    title={ativo ? `Remover ${emp.nome} do filtro` : `Filtrar só ${emp.nome}`}
                  >
                    {emp.nome}
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Banner de cobertura Sólides ──
              Quem caiu em fallback ou está sem CPF — risco de "inconformidade"
              ser na verdade só ausência de quadro na Sólides. Só aparece
              fora do modo "Mês todo" (no agregado a cobertura é por semana
              e perde sentido). */}
          {coberturaSolides && !mesTodo && (
            coberturaSolides.solidesFalhou ||
            coberturaSolides.semCpf.length > 0 ||
            coberturaSolides.semMatch.length > 0 ||
            coberturaSolides.semQuadro.length > 0
          ) && (
            <div className="mb-3 rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-200">
              <div className="font-semibold mb-1">⚠ Cobertura da Sólides incompleta</div>
              {coberturaSolides.solidesFalhou && (
                <div className="text-[12px]">
                  Nenhum quadro veio da Sólides — usando escala do Planejamento pra todos os empregados. Reabrir a semana pode resolver se foi falha pontual de rede.
                </div>
              )}
              {coberturaSolides.semCpf.length > 0 && (
                <div className="text-[12px]">
                  <strong>{coberturaSolides.semCpf.length}</strong> sem CPF no Planejamento (não dá match com Sólides):
                  {" "}<span className="italic">{coberturaSolides.semCpf.slice(0, 6).map(e => e.nome).join(", ")}</span>
                  {coberturaSolides.semCpf.length > 6 && ` +${coberturaSolides.semCpf.length - 6}`}
                </div>
              )}
              {coberturaSolides.semMatch.length > 0 && (
                <div className="text-[12px]">
                  <strong>{coberturaSolides.semMatch.length}</strong> com CPF que não casou na lista Sólides (confira pontuação/dígitos):
                  {" "}<span className="italic">{coberturaSolides.semMatch.slice(0, 6).map(e => e.nome).join(", ")}</span>
                  {coberturaSolides.semMatch.length > 6 && ` +${coberturaSolides.semMatch.length - 6}`}
                </div>
              )}
              {coberturaSolides.semQuadro.length > 0 && (
                <div className="text-[12px]">
                  <strong>{coberturaSolides.semQuadro.length}</strong> com CPF na Sólides mas sem quadro de horários atribuído lá:
                  {" "}<span className="italic">{coberturaSolides.semQuadro.slice(0, 6).map(e => e.nome).join(", ")}</span>
                  {coberturaSolides.semQuadro.length > 6 && ` +${coberturaSolides.semQuadro.length - 6}`}
                </div>
              )}
              <div className="text-[11px] mt-1.5 text-amber-700 dark:text-amber-300/80">
                Esses casos estão sendo avaliados pela escala do Planejamento como fallback. Pra ficar 100% consistente, ajuste o cadastro na Sólides e atualize.
              </div>
            </div>
          )}

          {/* ── Lista agrupada por colaborador → data ── */}
          {grupos.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
              <div className="text-4xl mb-3">✅</div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">
                Nenhum empregado no período
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Atualize o relatório ou ajuste os filtros.
              </p>
            </div>
          ) : (() => {
            // Função pra classificar — pendente = tem inconformidade com algo
            // ainda não-terminal. Tudo tratado = inconformidades == 0 OU todas
            // tratadas. Empregados sem vistaCompleta entram em pendentes se
            // têm exception.
            const isPendente = (g: GrupoColab): boolean => {
              if (!g.vistaCompleta) return g.totalExc > 0;
              return g.summary.inconformidades > 0 && g.summary.pendentes > 0;
            };
            const gruposPendentes = grupos.filter(isPendente);
            const gruposTratados = grupos.filter((g) => !isPendente(g));
            const totalPendentes = gruposPendentes.length;
            const totalTratados = gruposTratados.length;
            // Ordenadas: pendentes primeiro, tratados depois.
            const gruposOrdenados = [...gruposPendentes, ...gruposTratados];
            const indexPrimeiroTratado = gruposPendentes.length;
            return (
            <div className="space-y-4">
              {totalPendentes > 0 && (
                <div className="text-[11px] uppercase tracking-wider font-bold text-amber-700 dark:text-amber-400 -mb-2 px-1">
                  ⚠ Pendentes — {totalPendentes} empregado{totalPendentes === 1 ? "" : "s"}
                </div>
              )}
              {gruposOrdenados.map((grupo, idx) => {
                const tudoTratadoNoGrupo = !isPendente(grupo);
                const inserirSeparador = idx === indexPrimeiroTratado && totalPendentes > 0;
                // Dias analisados do empregado dentro do filtro (mês ou
                // semanas selecionadas). Vem do cache; serve pra mostrar
                // "✓ Sem inconformidade" em dias avaliados sem exception.
                // Só usado no modo legado (sem escalaEfetivaPorCpf).
                const cpfD = (grupo.cpf || "").replace(/\D/g, "");
                const diasAnalisados = (
                  displayedResult?.diasAnalisadosPorCpf?.[cpfD] || []
                ).filter((d) => {
                  // Mantém só dias dentro do filtro de semana
                  if (semanasFiltro.size === 0) return true;
                  return semanasMes.some(
                    (w) =>
                      semanasFiltro.has(w.index) &&
                      w.weekStart <= d &&
                      w.weekEnd >= d,
                  );
                });
                return (
                <React.Fragment key={grupo.key}>
                  {inserirSeparador && (
                    <div className="text-[11px] uppercase tracking-wider font-bold text-emerald-700 dark:text-emerald-400 px-1 pt-3 mt-3 border-t border-gray-200 dark:border-gray-800">
                      ✓ Tudo tratado — {totalTratados} empregado{totalTratados === 1 ? "" : "s"}
                    </div>
                  )}
                <ColaboradorBlock
                  grupo={grupo}
                  tudoTratado={tudoTratadoNoGrupo}
                  diasAnalisados={diasAnalisados}
                  podeAnotar={!semanaConferida}
                  temWhatsapp={!!whatsByEmpId.get(grupo.empregadoId)}
                  apontamentosPorChave={apontamentosPorChave}
                  notas={notasPorEmpregado.get(grupo.empregadoId) || []}
                  batidasPorCpfData={displayedResult?.batidasPorCpfData}
                  onApagarNota={apagarNotaInterna}
                  onAdicionarNotaApontamento={(exc, texto) => adicionarNotaApontamento(grupo.empregadoId, grupo.nome, exc, texto)}
                  statusDiaMap={statusDiaMap}
                  statusApontamentoMap={statusApontamentoMap}
                  salvandoApontamento={salvandoApontamento}
                  onAplicarStatusApontamento={(e, novo) => aplicarStatusApontamento({
                    empregadoId: grupo.empregadoId,
                    empregadoNome: grupo.nome,
                    data: e.date,
                    ruleId: e.ruleId,
                    novoStatus: novo,
                  })}
                  onReabrirApontamento={(e) => reabrirApontamento({
                    empregadoId: grupo.empregadoId,
                    empregadoNome: grupo.nome,
                    data: e.date,
                    ruleId: e.ruleId,
                  })}
                  loteDoEmpregado={lotesDocs.get(grupo.empregadoId)}
                  loteApontamentos={resolverApontamentosDoLote(grupo.empregadoId)}
                  onToggleLote={(exc) => toggleLote(grupo.empregadoId, exc)}
                  onMarcarEmpresaResolve={(exc) => marcarEmpresaResolve(grupo.empregadoId, exc)}
                  onAtualizarDia={(date) => atualizarUmDia(grupo.empregadoId, date)}
                  onEnviarLoteWhats={() => enviarLoteWhats(grupo.empregadoId)}
                  onEnviarLotePresencial={() => enviarLotePresencial(grupo.empregadoId)}
                  onCancelarLote={() => cancelarLote(grupo.empregadoId)}
                />
                </React.Fragment>
                );
              })}
            </div>
            );
          })()}
        </>
      )}

      {!displayedResult && !loading && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            Escolha o período e clique em "Gerar relatório"
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            O sistema busca as marcações de ponto na Sólides, cruza com a escala prevista e lista as
            não-conformidades.
          </p>
        </div>
      )}
      {/* Modal de preview do PDF — abre antes de baixar, pra o líder
          conferir o conteúdo. Esc / clique fora / botão Fechar = cancela. */}
      {previewPdf && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={fecharPreviewPdf}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-2">
              <div className="font-bold text-gray-900 dark:text-gray-100 truncate">
                📄 Preview — {previewPdf.filename}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={baixarPreviewPdf}
                  className="text-xs font-semibold px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  📥 Baixar PDF
                </button>
                <button
                  type="button"
                  onClick={fecharPreviewPdf}
                  className="text-xs font-semibold px-3 py-1.5 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  Fechar
                </button>
              </div>
            </div>
            <iframe
              src={previewPdf.url}
              title="Preview PDF"
              className="flex-1 w-full border-0 bg-gray-100 dark:bg-gray-950"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Agrupamento Colaborador → Data → exceções ─────────────────────────────
// Linha individual de dia do empregado — discriminated union pra render lidar
// com cada estado visual sem ambiguidade.
type DayRow =
  | { date: string; tipo: "trabalho_ok" }
  | { date: string; tipo: "trabalho_incon"; exceptions: ExceptionRecord[] }
  | { date: string; tipo: "folga" }
  // ferias/atestado/abono/falta_j — hoje todos colapsam em "folga" no
  // aplicarAjustesNaEscala, então essa linha vira "Ajuste aprovado" genérico.
  // Refinar depois preservando razão original (#TODO).
  | { date: string; tipo: "ajuste_aprovado" }
  | { date: string; tipo: "compensado" }       // status "comp"
  | { date: string; tipo: "trabalho_comp" }    // status "comp_trab"
  | { date: string; tipo: "desconhecido" };

type DaySummary = {
  trabalho: number;       // trabalho_ok + trabalho_comp
  folga: number;          // folga + compensado
  ajusteAprovado: number; // ajuste_aprovado
  inconformidades: number;
  pendentes: number;      // dias incon com algum apontamento NÃO terminal
  aguardando: number;     // dias incon com TODOS os apontamentos não-terminais em "aguardando_ajuste" (subset de pendentes)
};

type GrupoColab = {
  key: string;
  empregadoId: string;
  nome: string;
  cpf: string;
  totalExc: number;
  totalGraves: number;
  // Compat antigo — render usa só pra cache de exception por data
  porData: { date: string; exc: ExceptionRecord[] }[];
  // NOVO: lista completa de dias do mês até hoje (vazia em modo legado, quando
  // o cache não traz escalaEfetivaPorCpf).
  dias: DayRow[];
  summary: DaySummary;
  // Indica se a visualização completa está disponível pra esse empregado.
  // false ⇒ render cai no modo legado (só dias com exception + dias verdes).
  vistaCompleta: boolean;
};

// F6 — Detecção retroativa: pra cada exception de faltaSemAjuste/
// marcacaoForaDaEscala, verifica se o líder já ajustou manualmente o
// status na escala praticada. Se sim, marca o apontamento como ciência
// auto + nota interna.
async function detectarAjustesManuaisRetroativos(input: {
  rid: string;
  weekStart: string;
  weekEnd: string;
  excecoes: ExceptionRecord[];
  empIdByCpf: Map<string, string>;
  statusSemanaAtual: ExcecaoStatusSemana | null;
  me: Pessoa;
}): Promise<void> {
  const { rid, weekStart, weekEnd, statusSemanaAtual, me } = input;
  void input.excecoes; void input.empIdByCpf; // disponíveis pra futura expansão
  if (!statusSemanaAtual?.apontamentos?.length) return;

  // Filtra só apontamentos pendentes de ausência/presença divergente
  const pendentesAusenciaPresenca = statusSemanaAtual.apontamentos.filter(a =>
    a.status === "pendente" &&
    (a.ruleId === "faltaSemAjuste" || a.ruleId === "marcacaoForaDaEscala")
  );
  if (pendentesAusenciaPresenca.length === 0) return;

  // Agrupa por mês pra fazer 1 getDoc por mês
  const porMes = new Map<string, typeof pendentesAusenciaPresenca>();
  for (const a of pendentesAusenciaPresenca) {
    if (!a.data) continue;
    const yyyymm = a.data.slice(0, 7);
    const arr = porMes.get(yyyymm) || [];
    arr.push(a);
    porMes.set(yyyymm, arr);
  }

  for (const [yyyymm, lista] of porMes) {
    const ano = parseInt(yyyymm.slice(0, 4), 10);
    const mes = parseInt(yyyymm.slice(5, 7), 10);
    const escalaId = `${rid}_${fmtAnoMes(ano, mes)}`;
    const snap = await getDoc(doc(db, "escalas", escalaId));
    if (!snap.exists()) continue;
    const d = snap.data() as { real?: Record<string, Record<string, string>> };

    for (const ap of lista) {
      if (!ap.data) continue;
      const real = d.real?.[ap.empregadoId]?.[ap.data];
      // Pra faltaSemAjuste: já está ajustado se real != "trabalho" e !== undefined
      // Pra marcacaoForaDaEscala: já está ajustado se real == "trabalho" ou comp_trab
      let foiAjustado = false;
      if (ap.ruleId === "faltaSemAjuste") {
        foiAjustado = !!real && real !== "trabalho";
      } else if (ap.ruleId === "marcacaoForaDaEscala") {
        foiAjustado = real === "trabalho" || real === "comp_trab" || real === "freela";
      }
      if (!foiAjustado) continue;

      // Marca como ciência + cria nota
      try {
        await marcarApontamentoCiencia(rid, weekStart, weekEnd, ap.id, me);
        await adicionarNotaInterna(rid, weekStart, weekEnd, {
          empregadoId: ap.empregadoId,
          empregadoNome: ap.empregadoNome,
          texto: `🔄 Ajuste detectado retroativamente na escala: status "${real}" em ${ap.data}. Apontamento marcado como tratado.`,
          origem: "ciencia",
          apontamentoIds: [ap.id],
        }, me);
      } catch (e) {
        console.warn("[retroativo] falha:", e);
      }
    }
  }
}

// Lista todos os dias do mês ativo até hoje (YYYY-MM-DD). Sem futuro.
function diasDoMesAteHoje(ano: number, mes: number, hojeYmd: string): string[] {
  const out: string[] = [];
  const ultimoDia = new Date(ano, mes, 0).getDate(); // mes 1-indexed, dia 0 = último do mês anterior → trick
  for (let d = 1; d <= ultimoDia; d++) {
    const ymd = `${ano}-${pad2(mes)}-${pad2(d)}`;
    if (ymd > hojeYmd) break;
    out.push(ymd);
  }
  return out;
}

// Monta lista de DayRow pra UM empregado dado seu CPF + estado da escala
// efetiva + exceptions já agrupadas por data.
function montarDiasDoEmpregado(
  cpf: string,
  empId: string,
  escalaEfetivaPorCpf: Record<string, Record<string, ScheduleStatus>>,
  exceptionsByEmpDate: Map<string /* empId_date */, ExceptionRecord[]>,
  exceptionsByCpfDate: Map<string /* cpf_date */, ExceptionRecord[]>,
  diasMes: string[],
  vinculo?: { admissao?: string | null; demissao?: string | null },
): DayRow[] {
  const escala = escalaEfetivaPorCpf[cpf] || {};
  const rows: DayRow[] = [];
  const admissao = vinculo?.admissao || null;
  const demissao = vinculo?.demissao || null;
  for (const date of diasMes) {
    // Pula dias fora do período de vínculo — não eram empregados da gente.
    if (admissao && date < admissao) continue;
    if (demissao && date > demissao) continue;
    // Tenta resolver exceções 1º por empId (chave estável) e fallback por cpf
    // (modo "Mês todo" pode ter exception sem empId quando o CPF não casou).
    const exc =
      (empId ? exceptionsByEmpDate.get(`${empId}_${date}`) : undefined) ||
      exceptionsByCpfDate.get(`${cpf}_${date}`) ||
      [];
    const st = escala[date];
    if (exc.length > 0) {
      rows.push({ date, tipo: "trabalho_incon", exceptions: exc });
      continue;
    }
    if (st === "trabalho" || st === "freela") {
      rows.push({ date, tipo: "trabalho_ok" });
    } else if (st === "folga") {
      // Hoje aplicarAjustesNaEscala colapsa ferias/atestado/abono/falta_j
      // em "folga" — não dá pra distinguir aqui. Mostra como folga simples
      // por enquanto. (Pra v2: preservar razão e diferenciar.)
      rows.push({ date, tipo: "folga" });
    } else if (st === "ferias" || st === "falta_j") {
      rows.push({ date, tipo: "ajuste_aprovado" });
    } else if (st === "comp") {
      rows.push({ date, tipo: "compensado" });
    } else if (st === "comp_trab") {
      rows.push({ date, tipo: "trabalho_comp" });
    } else if (st === "falta_i") {
      // Falta não-justificada sem exception é raro (geralmente vira
      // "faltaSemAjuste" no relatório). Trata como desconhecido pra não
      // mostrar verde indevidamente.
      rows.push({ date, tipo: "desconhecido" });
    } else {
      rows.push({ date, tipo: "desconhecido" });
    }
  }
  return rows;
}

function computarSummary(
  dias: DayRow[],
  empId: string,
  apontamentosPorChave: Map<string, ApontamentoFuncionario>,
  statusApontamentoMap: Map<string, PontoApontamentoStatusDoc>,
  statusDiaMap?: Map<string, PontoDiaStatusDoc>,
): DaySummary {
  let trabalho = 0, folga = 0, ajusteAprovado = 0, inconformidades = 0, pendentes = 0, aguardando = 0;
  for (const r of dias) {
    if (r.tipo === "trabalho_ok" || r.tipo === "trabalho_comp") trabalho++;
    else if (r.tipo === "folga" || r.tipo === "compensado") folga++;
    else if (r.tipo === "ajuste_aprovado") ajusteAprovado++;
    else if (r.tipo === "trabalho_incon") {
      inconformidades++;
      // "Pendente" = algum apontamento NÃO-terminal nesse dia.
      const diaLegado = statusDiaMap?.get(`${empId}_${r.date}`);
      const diaLegadoTerminal =
        diaLegado?.status === "tratado" || diaLegado?.status === "corrigido_solides";
      const dedupRules = new Set(r.exceptions.map(e => e.ruleId));
      let temPendente = false;
      let temNaoAguardandoEntreOsPendentes = false;
      let temAlgumAguardando = false;
      for (const ruleId of dedupRules) {
        const doc = statusApontamentoMap.get(apontamentoKey(empId, r.date, ruleId));
        const s = doc?.status ?? (diaLegadoTerminal ? "ciencia" : "aberto");
        if (!isStatusTerminal(s)) {
          temPendente = true;
          // "aguardando" no chip do empregado agrega 2 estados não-terminais
          // mas "em movimento": aguardando_ajuste (empregado vai resolver) +
          // empresa_ajustara (empresa vai resolver). Ambos contam como
          // progresso já feito pelo líder — só falta confirmar na Sólides.
          if (s === "aguardando_ajuste" || s === "empresa_ajustara") temAlgumAguardando = true;
          else temNaoAguardandoEntreOsPendentes = true;
        }
      }
      void apontamentosPorChave;
      if (temPendente) pendentes++;
      // "Aguardando" no resumo do dia = tem ao menos 1 aguardando E não
      // tem outros pendentes não-aguardando. Senão, conta só em pendentes.
      if (temAlgumAguardando && !temNaoAguardandoEntreOsPendentes) aguardando++;
    }
  }
  return { trabalho, folga, ajusteAprovado, inconformidades, pendentes, aguardando };
}

// `empIdByCpf` resolve o ID do Planejamento (string) — exc.employeeId é o
// ID da Sólides (number), inadequado pra ancorar apontamentos.
//
// V2: agora recebe TODA a base de empregados que batem ponto (após filtros de
// área/empregado), o snapshot da escala efetiva + a lista de dias do mês ativo
// até hoje. Empregados sem exception aparecem na lista quando há vista
// completa disponível. Empregados sem escalaEfetiva → fallback antigo (só
// dias com exception + verdes via diasAnalisadosPorCpf).
function agruparPorColabDate(
  rows: ExceptionRecord[],
  empIdByCpf: Map<string, string>,
  basePessoas: Array<{ id: string; nome: string; cpf: string; admissao?: string | null; demissao?: string | null }>,
  escalaEfetivaPorCpf: Record<string, Record<string, ScheduleStatus>>,
  diasMes: string[],
  apontamentosPorChave: Map<string, ApontamentoFuncionario>,
  statusApontamentoMap: Map<string, PontoApontamentoStatusDoc>,
  statusDiaMap?: Map<string, PontoDiaStatusDoc>,
): GrupoColab[] {
  // Indexa exceptions por (empId, date) e (cpf, date) pra resolução rápida.
  const exceptionsByEmpDate = new Map<string, ExceptionRecord[]>();
  const exceptionsByCpfDate = new Map<string, ExceptionRecord[]>();
  // Acumulador de "empregado avulso" — caiu no relatório mas não está em
  // basePessoas (CPF não casou no Planejamento). Mantido pra não esconder.
  type Acc = {
    empregadoId: string;
    nome: string;
    cpf: string;
    porData: Map<string, ExceptionRecord[]>;
  };
  const avulsoMap = new Map<string, Acc>();
  const cpfsDaBase = new Set(basePessoas.map(p => (p.cpf || "").replace(/\D/g, "")));

  // Supressão de regras derivadas quando há `batidasImpares` ATIVO no dia.
  //
  // Quando o dia tem batida ímpar (ex.: 3 batidas com a 1ª às 10:25), as regras
  // derivadas das batidas (atraso, intervalo, jornada, interjornada, bloco
  // suspeito) ficam ambíguas — não dá pra afirmar "atrasou 2h25" se talvez a
  // 1ª batida seja uma volta de intervalo. O líder primeiro alinha as batidas;
  // depois que o empregado corrigir na Sólides (status `corrigido_solides`)
  // OU o líder marcar como `nao_e_inconformidade` (assumindo as batidas como
  // corretas), as regras derivadas reaparecem.
  const REGRAS_DERIVADAS_DE_BLOCOS: ReadonlySet<ExceptionRecord["ruleId"]> = new Set([
    "atrasoEntrada",
    "intervaloMenorQueLegal",
    "interjornadaCurta",
    "jornadaAcimaDe10h",
    "blocoSuspeito",
  ]);
  const diasComBatidasImparesAtivas = new Set<string>();
  for (const e of rows) {
    if (e.ruleId !== "batidasImpares") continue;
    const cpfD = (e.cpf || "").replace(/\D/g, "");
    const empId = empIdByCpf.get(cpfD) ?? "";
    if (!empId) continue;
    const doc = statusApontamentoMap.get(apontamentoKey(empId, e.date, "batidasImpares"));
    const s = doc?.status ?? "aberto";
    if (s !== "nao_e_inconformidade" && s !== "corrigido_solides") {
      diasComBatidasImparesAtivas.add(`${empId}_${e.date}`);
    }
  }
  const rowsFiltradas = rows.filter(e => {
    if (!REGRAS_DERIVADAS_DE_BLOCOS.has(e.ruleId)) return true;
    const cpfD = (e.cpf || "").replace(/\D/g, "");
    const empId = empIdByCpf.get(cpfD) ?? "";
    if (!empId) return true;
    return !diasComBatidasImparesAtivas.has(`${empId}_${e.date}`);
  });

  for (const e of rowsFiltradas) {
    const cpfD = (e.cpf || "").replace(/\D/g, "");
    const empId = empIdByCpf.get(cpfD) ?? "";
    if (empId) {
      const k = `${empId}_${e.date}`;
      const arr = exceptionsByEmpDate.get(k) ?? [];
      arr.push(e);
      exceptionsByEmpDate.set(k, arr);
    }
    if (cpfD) {
      const k = `${cpfD}_${e.date}`;
      const arr = exceptionsByCpfDate.get(k) ?? [];
      arr.push(e);
      exceptionsByCpfDate.set(k, arr);
    }
    // Se o empregado não está na basePessoas (ex.: cargo não bate ponto +
    // alguma marcação espúria), garante um grupo "avulso" pra ele aparecer
    // como antes.
    if (!cpfD || !cpfsDaBase.has(cpfD)) {
      const k = cpfD || `s_${e.employeeId}_${e.employeeName}`;
      let g = avulsoMap.get(k);
      if (!g) {
        g = { empregadoId: empId, nome: e.employeeName, cpf: e.cpf, porData: new Map() };
        avulsoMap.set(k, g);
      }
      const arr = g.porData.get(e.date) ?? [];
      arr.push(e);
      g.porData.set(e.date, arr);
    }
  }

  const out: GrupoColab[] = [];

  // 1) Empregados da base (batem ponto + passaram filtros)
  for (const p of basePessoas) {
    const cpfD = (p.cpf || "").replace(/\D/g, "");
    const temEscala = !!escalaEfetivaPorCpf[cpfD] && Object.keys(escalaEfetivaPorCpf[cpfD]).length > 0;
    // Sem cache de escala: cai no modo legado — só renderiza se tem exception.
    if (!temEscala) {
      const excDoEmp = rowsFiltradas.filter(e => (e.cpf || "").replace(/\D/g, "") === cpfD);
      if (excDoEmp.length === 0) continue;
      const porDataMap = new Map<string, ExceptionRecord[]>();
      for (const e of excDoEmp) {
        const arr = porDataMap.get(e.date) ?? [];
        arr.push(e);
        porDataMap.set(e.date, arr);
      }
      const porData = Array.from(porDataMap.entries())
        .map(([date, exc]) => ({ date, exc }))
        .sort((a, b) => a.date.localeCompare(b.date));
      const total = porData.reduce((s, d) => s + d.exc.length, 0);
      const graves = porData.reduce((s, d) => s + d.exc.filter(e => e.severity === "grave").length, 0);
      out.push({
        key: cpfD || p.id,
        empregadoId: p.id,
        nome: p.nome,
        cpf: p.cpf,
        totalExc: total,
        totalGraves: graves,
        porData,
        dias: [],
        summary: { trabalho: 0, folga: 0, ajusteAprovado: 0, inconformidades: total, pendentes: 0, aguardando: 0 },
        vistaCompleta: false,
      });
      continue;
    }
    // Vista completa: monta TODOS os dias do mês até hoje. Pula dias antes
    // da admissão ou depois da demissão.
    const dias = montarDiasDoEmpregado(
      cpfD, p.id, escalaEfetivaPorCpf, exceptionsByEmpDate, exceptionsByCpfDate, diasMes,
      { admissao: p.admissao, demissao: p.demissao },
    );
    const summary = computarSummary(dias, p.id, apontamentosPorChave, statusApontamentoMap, statusDiaMap);
    // porData (compat) — só dias com exception
    const porData = dias
      .filter((r): r is Extract<DayRow, { tipo: "trabalho_incon" }> => r.tipo === "trabalho_incon")
      .map(r => ({ date: r.date, exc: r.exceptions }));
    const totalExc = porData.reduce((s, d) => s + d.exc.length, 0);
    const totalGraves = porData.reduce((s, d) => s + d.exc.filter(e => e.severity === "grave").length, 0);
    out.push({
      key: cpfD || p.id,
      empregadoId: p.id,
      nome: p.nome,
      cpf: p.cpf,
      totalExc,
      totalGraves,
      porData,
      dias,
      summary,
      vistaCompleta: true,
    });
  }

  // 2) Avulsos (não estão na base, mas têm exception) — render no modo legado.
  for (const [key, g] of avulsoMap) {
    const porData = Array.from(g.porData.entries())
      .map(([date, exc]) => ({ date, exc }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const total = porData.reduce((s, d) => s + d.exc.length, 0);
    const graves = porData.reduce((s, d) => s + d.exc.filter(e => e.severity === "grave").length, 0);
    out.push({
      key,
      empregadoId: g.empregadoId,
      nome: g.nome,
      cpf: g.cpf,
      totalExc: total,
      totalGraves: graves,
      porData,
      dias: [],
      summary: { trabalho: 0, folga: 0, ajusteAprovado: 0, inconformidades: total, pendentes: 0, aguardando: 0 },
      vistaCompleta: false,
    });
  }

  return out.sort((a, b) => a.nome.localeCompare(b.nome));
}

function fmtCpf(d: string): string {
  const x = (d || "").replace(/\D/g, "");
  if (x.length !== 11) return d;
  return `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6, 9)}-${x.slice(9)}`;
}

function fmtDataBr(ymd: string): string {
  const [a, m, d] = ymd.split("-");
  if (!a || !m || !d) return ymd;
  return `${d}/${m}/${a}`;
}

function diaDaSemana(ymd: string): string {
  const [a, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  if (!a || !m || !d) return "";
  const dt = new Date(a, m - 1, d);
  return dt.toLocaleDateString("pt-BR", { weekday: "long" });
}

function ColaboradorBlock({
  grupo,
  tudoTratado,
  diasAnalisados,
  podeAnotar,
  temWhatsapp,
  apontamentosPorChave,
  notas,
  batidasPorCpfData,
  onApagarNota,
  onAdicionarNotaApontamento,
  statusDiaMap,
  statusApontamentoMap,
  salvandoApontamento,
  onAplicarStatusApontamento,
  onReabrirApontamento,
  loteDoEmpregado,
  loteApontamentos,
  onToggleLote,
  onMarcarEmpresaResolve,
  onAtualizarDia,
  onEnviarLoteWhats,
  onEnviarLotePresencial,
  onCancelarLote,
}: {
  grupo: GrupoColab;
  tudoTratado: boolean;
  diasAnalisados: string[];
  podeAnotar: boolean;
  temWhatsapp: boolean;
  apontamentosPorChave: Map<string, ApontamentoFuncionario>;
  notas: NotaInterna[];
  batidasPorCpfData?: Record<string, Record<string, string>>;
  onApagarNota: (notaId: string) => void;
  onAdicionarNotaApontamento: (exc: ExceptionRecord, texto: string) => Promise<void> | void;
  statusDiaMap?: Map<string, PontoDiaStatusDoc>;
  statusApontamentoMap: Map<string, PontoApontamentoStatusDoc>;
  salvandoApontamento: Set<string>;
  onAplicarStatusApontamento: (
    exc: ExceptionRecord,
    novoStatus: PontoApontamentoStatus,
  ) => Promise<void> | void;
  onReabrirApontamento: (exc: ExceptionRecord) => Promise<void> | void;
  loteDoEmpregado?: LoteRascunhoDoc;
  loteApontamentos: ExceptionRecord[];
  onToggleLote: (exc: ExceptionRecord) => void;
  onMarcarEmpresaResolve: (exc: ExceptionRecord) => Promise<void> | void;
  onAtualizarDia: (date: string) => Promise<void> | void;
  onEnviarLoteWhats: () => void;
  onEnviarLotePresencial: () => void;
  onCancelarLote: () => void;
}) {
  const [expandido, setExpandido] = useState(false);
  // Indexa as notas do empregado por (data_ruleId) — usado pra renderizar
  // direto no card do apontamento. Notas sem `apontamentoChave` ficam de fora
  // (vão na timeline geral da semana, mantém compatibilidade com o que existe).
  const notasPorApontamentoKey = useMemo(() => {
    const m = new Map<string, NotaInterna[]>();
    for (const n of notas) {
      if (!n.apontamentoChave) continue;
      const arr = m.get(n.apontamentoChave) || [];
      arr.push(n);
      m.set(n.apontamentoChave, arr);
    }
    return m;
  }, [notas]);
  return (
    <section className={`border rounded-xl overflow-hidden transition-colors ${
      tudoTratado
        ? "bg-emerald-50/50 dark:bg-emerald-900/15 border-emerald-200 dark:border-emerald-800/60"
        : "bg-amber-50/30 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/40"
    }`}>
      <header
        className={`px-4 py-2.5 border-b flex items-center justify-between flex-wrap gap-2 cursor-pointer ${
          tudoTratado
            ? "bg-emerald-100/60 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800/60"
            : "bg-amber-100/60 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/40"
        }`}
        onClick={() => setExpandido((v) => !v)}
      >
        <div className="min-w-0 flex items-center gap-2">
          <span className="text-gray-400">{expandido ? "▼" : "▶"}</span>
          <div>
            <div className="font-bold text-gray-900 dark:text-gray-100">{grupo.nome}</div>
            {grupo.cpf && (
              <div className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">
                CPF {fmtCpf(grupo.cpf)}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] flex-wrap" onClick={(e) => e.stopPropagation()}>
          {grupo.vistaCompleta ? (() => {
            // Cor do chip de inconformidades baseado no progresso:
            //  - verde:   todas tratadas (terminal)
            //  - âmbar:   parcialmente tratado OU tudo no lote (aguardando)
            //  - rosa:    nada feito (zero tratadas, zero aguardando)
            // Quando não há inconformidades, mostra só o resumo cinza.
            // `aguardando` ⊆ `pendentes` no summary — apontamentos no lote
            // contam como pendentes E aguardando.
            const total = grupo.summary.inconformidades;
            const pendentes = grupo.summary.pendentes;
            const aguardando = grupo.summary.aguardando;
            const tratadas = total - pendentes;
            let chipCls = "text-gray-700 dark:text-gray-200";
            let chipIcon = "";
            if (total > 0) {
              if (pendentes === 0) {
                chipCls = "text-emerald-700 dark:text-emerald-400 font-bold";
                chipIcon = "✓ ";
              } else if (tratadas === 0 && aguardando === 0) {
                chipCls = "text-rose-700 dark:text-rose-400 font-bold";
                chipIcon = "⚠ ";
              } else {
                // Tem progresso (tratado ou aguardando) — âmbar.
                chipCls = "text-amber-700 dark:text-amber-400 font-bold";
                chipIcon = "◐ ";
              }
            }
            return (
              <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 font-semibold tabular-nums">
                <span className="text-gray-700 dark:text-gray-200">
                  {grupo.summary.trabalho} trab · {grupo.summary.folga} folga · {grupo.summary.ajusteAprovado} ajuste
                </span>
                {total > 0 && (
                  <>
                    {" · "}
                    <span className={chipCls}>
                      {chipIcon}
                      {total} inconformidades:
                      {(() => {
                        // Decompõe em "X tratadas · Y aguardando · Z pendentes".
                        // Omite partes com 0. "Aguardando" só aparece quando há.
                        const pendentesNaoAguardando = pendentes - aguardando;
                        const partes: string[] = [];
                        partes.push(`${tratadas} tratadas`);
                        if (aguardando > 0) partes.push(`${aguardando} aguardando`);
                        if (pendentesNaoAguardando > 0) partes.push(`${pendentesNaoAguardando} pendentes`);
                        return <> {partes.join(" · ")}</>;
                      })()}
                    </span>
                  </>
                )}
              </span>
            );
          })() : (
            <>
              <span className="px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold">
                {grupo.totalExc} exc.
              </span>
              {grupo.totalGraves > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 font-semibold">
                  {grupo.totalGraves} grave(s)
                </span>
              )}
            </>
          )}
        </div>
      </header>

      {/* Bloco de Lote de ajustes — sempre visível (mesmo com o card
          colapsado) pra o líder não esquecer de enviar. Quando enviado,
          continua aparecendo com botão "Reenviar" + log do(s) envio(s);
          some só com clique em "Cancelar" ou quando todos os apontamentos
          do lote forem corrigidos no Sólides. */}
      {loteDoEmpregado && (loteDoEmpregado.apontamentoChaves?.length || 0) > 0 && (() => {
        const jaEnviado = !!loteDoEmpregado.enviadoEm;
        const reenvios = loteDoEmpregado.reenvios || [];
        // Particiona em 2 grupos pra mostrar separados no box.
        const itensEmpresa: ExceptionRecord[] = [];
        const itensEmpregado: ExceptionRecord[] = [];
        for (const a of loteApontamentos) {
          const stApon = statusApontamentoMap.get(
            apontamentoKey(grupo.empregadoId, a.date, a.ruleId),
          )?.status;
          if (stApon === "empresa_ajustara") itensEmpresa.push(a);
          else itensEmpregado.push(a);
        }
        const totalLote = loteDoEmpregado.apontamentoChaves.length;
        return (
        <div className="mx-4 mt-3 mb-2 p-3 rounded-lg border-2 border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <div className="font-semibold text-amber-900 dark:text-amber-200 text-sm">
              📦 Lote de ajustes — {totalLote} apontamento(s)
              {itensEmpresa.length > 0 && itensEmpregado.length > 0 && (
                <span className="ml-1 font-normal text-[11px] text-amber-800/80 dark:text-amber-300/80">
                  ({itensEmpregado.length} pro empregado · {itensEmpresa.length} pra empresa)
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onEnviarLoteWhats}
                disabled={!temWhatsapp}
                className={`text-[11px] font-semibold px-3 py-1 rounded-md text-white whitespace-nowrap ${
                  temWhatsapp
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
                }`}
                title={
                  temWhatsapp
                    ? jaEnviado
                      ? "Reabrir o WhatsApp com a mensagem do lote — registra como reenvio"
                      : "Abre o WhatsApp com a mensagem do lote e marca cada apontamento como aguardando ajuste"
                    : "Sem WhatsApp cadastrado em Pessoas pra este empregado"
                }
              >
                {jaEnviado ? "🔁 Reenviar WhatsApp" : "📱 Enviar por WhatsApp"}
              </button>
              <button
                type="button"
                onClick={onEnviarLotePresencial}
                className="text-[11px] font-semibold px-3 py-1 rounded-md bg-sky-600 text-white hover:bg-sky-700 whitespace-nowrap"
                title={jaEnviado
                  ? "Registrar nova conversa presencial sobre o lote (reenvio)"
                  : "Registrar como alinhado presencialmente (sem enviar WhatsApp)"}
              >
                {jaEnviado ? "🔁 Reforçar presencialmente" : "🗣 Alinhei presencialmente"}
              </button>
              <button
                type="button"
                onClick={onCancelarLote}
                className="text-[11px] text-gray-600 dark:text-gray-400 hover:underline px-2 py-1 whitespace-nowrap"
                title="Esvazia o lote (apaga o histórico de envios). Os apontamentos continuam com seus status atuais."
              >
                Cancelar
              </button>
            </div>
          </div>
          {/* Log dos envios — só aparece após o 1º envio */}
          {jaEnviado && (
            <div className="mb-2 text-[10.5px] text-amber-800 dark:text-amber-300 leading-snug">
              <div>
                ✓ Enviado em {fmtDataHora(loteDoEmpregado.enviadoEm!)}
                {loteDoEmpregado.enviadoTipo === "presencial" ? " (presencial)" : " (WhatsApp)"}
                {loteDoEmpregado.enviadoPorNome ? ` · ${loteDoEmpregado.enviadoPorNome}` : ""}
              </div>
              {reenvios.map((r, i) => (
                <div key={`${r.em}_${i}`}>
                  ↻ Reenviado em {fmtDataHora(r.em)}
                  {r.tipo === "presencial" ? " (presencial)" : " (WhatsApp)"}
                  {r.porNome ? ` · ${r.porNome}` : ""}
                </div>
              ))}
            </div>
          )}
          {/* Seção: Empregado vai ajustar (vai pra mensagem WhatsApp) */}
          {itensEmpregado.length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] uppercase tracking-wider font-bold text-amber-800 dark:text-amber-300 mb-1 flex items-center gap-1">
                📦 Empregado vai ajustar ({itensEmpregado.length})
              </div>
              <ul className="text-xs text-amber-900 dark:text-amber-200 space-y-0.5 ml-4">
                {itensEmpregado.map((a) => {
                  const meta = RULES_META[a.ruleId];
                  const label = meta?.label || a.ruleId;
                  const det = a.detail || a.description;
                  return (
                    <li key={`emp_${a.date}_${a.ruleId}`} className="tabular-nums">
                      · {fmtDataBr(a.date)} · {label}
                      {det ? ` · ${det}` : ""}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {/* Seção: Empresa vai resolver na Sólides (não vai na mensagem) */}
          {itensEmpresa.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-indigo-800 dark:text-indigo-300 mb-1 flex items-center gap-1">
                🏢 Empresa vai resolver na Sólides ({itensEmpresa.length})
              </div>
              <ul className="text-xs text-indigo-900 dark:text-indigo-200 space-y-0.5 ml-4">
                {itensEmpresa.map((a) => {
                  const meta = RULES_META[a.ruleId];
                  const label = meta?.label || a.ruleId;
                  const det = a.detail || a.description;
                  return (
                    <li key={`emp_resolve_${a.date}_${a.ruleId}`} className="tabular-nums">
                      · {fmtDataBr(a.date)} · {label}
                      {det ? ` · ${det}` : ""}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
        );
      })()}

      {expandido && (<>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {(() => {
          // Modo NOVO (vista completa): renderiza grupo.dias (TODOS os dias
          // do mês até hoje, com estados distintos).
          // Modo LEGADO: mistura exception + dias analisados verdes — usado
          // pra caches antigos sem escalaEfetivaPorCpf e pra empregados
          // avulsos (sem cadastro no Planejamento).
          type Linha =
            | { kind: "exc"; date: string; exc: ExceptionRecord[] }
            | { kind: "verde"; date: string }                      // legado
            | { kind: "trabalho_ok"; date: string }                // novo
            | { kind: "folga"; date: string }                      // novo
            | { kind: "ajuste_aprovado"; date: string }            // novo
            | { kind: "compensado"; date: string }                 // novo
            | { kind: "trabalho_comp"; date: string }              // novo
            | { kind: "desconhecido"; date: string };              // novo

          let todasAsLinhas: Linha[];
          if (grupo.vistaCompleta) {
            todasAsLinhas = grupo.dias.map<Linha>((r) => {
              if (r.tipo === "trabalho_incon") return { kind: "exc", date: r.date, exc: r.exceptions };
              if (r.tipo === "trabalho_ok") return { kind: "trabalho_ok", date: r.date };
              if (r.tipo === "folga") return { kind: "folga", date: r.date };
              if (r.tipo === "ajuste_aprovado") return { kind: "ajuste_aprovado", date: r.date };
              if (r.tipo === "compensado") return { kind: "compensado", date: r.date };
              if (r.tipo === "trabalho_comp") return { kind: "trabalho_comp", date: r.date };
              return { kind: "desconhecido", date: r.date };
            });
          } else {
            const datasComExc = new Set(grupo.porData.map(g => g.date));
            const datasVerdes = (diasAnalisados || []).filter(d => !datasComExc.has(d));
            todasAsLinhas = [
              ...grupo.porData.map<Linha>(g => ({ kind: "exc", date: g.date, exc: g.exc })),
              ...datasVerdes.map<Linha>(d => ({ kind: "verde", date: d })),
            ].sort((a, b) => a.date.localeCompare(b.date));
          }
          return todasAsLinhas.map((linha) => {
            if (linha.kind === "verde" || linha.kind === "trabalho_ok") {
              const cpfD = (grupo.cpf || "").replace(/\D/g, "");
              const batidas = batidasPorCpfData?.[cpfD]?.[linha.date];
              return (
                <div
                  key={linha.date}
                  className="px-4 py-2 bg-emerald-50/30 dark:bg-emerald-900/10 flex items-center gap-2 text-sm flex-wrap"
                >
                  <span className="text-emerald-700 dark:text-emerald-400">✓</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300 tabular-nums">
                    {fmtDataBr(linha.date)}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400 capitalize text-[11px]">
                    · {diaDaSemana(linha.date)}
                  </span>
                  <span className="text-emerald-700 dark:text-emerald-400 text-xs ml-1">
                    {linha.kind === "verde" ? "Sem inconformidade" : "Trabalhou normal"}
                  </span>
                  {batidas && (
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 font-mono tracking-tight ml-2">
                      📍 {batidas}
                    </span>
                  )}
                </div>
              );
            }
            if (linha.kind === "trabalho_comp") {
              const cpfD = (grupo.cpf || "").replace(/\D/g, "");
              const batidas = batidasPorCpfData?.[cpfD]?.[linha.date];
              return (
                <div
                  key={linha.date}
                  className="px-4 py-2 bg-emerald-50/30 dark:bg-emerald-900/10 flex items-center gap-2 text-sm flex-wrap"
                >
                  <span className="text-emerald-700 dark:text-emerald-400">✓</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300 tabular-nums">
                    {fmtDataBr(linha.date)}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400 capitalize text-[11px]">
                    · {diaDaSemana(linha.date)}
                  </span>
                  <span className="text-emerald-700 dark:text-emerald-400 text-xs ml-1">
                    Trabalhou (compensado)
                  </span>
                  {batidas && (
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 font-mono tracking-tight ml-2">
                      📍 {batidas}
                    </span>
                  )}
                </div>
              );
            }
            if (linha.kind === "folga" || linha.kind === "compensado") {
              return (
                <div
                  key={linha.date}
                  className="px-4 py-2 bg-gray-50/60 dark:bg-gray-800/30 flex items-center gap-2 text-sm"
                >
                  <span className="text-gray-500 dark:text-gray-400">💤</span>
                  <span className="font-medium text-gray-600 dark:text-gray-300 tabular-nums">
                    {fmtDataBr(linha.date)}
                  </span>
                  <span className="text-gray-400 dark:text-gray-500 capitalize text-[11px]">
                    · {diaDaSemana(linha.date)}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400 text-xs ml-1">
                    {linha.kind === "folga" ? "Folga programada" : "Compensado"}
                  </span>
                </div>
              );
            }
            if (linha.kind === "ajuste_aprovado") {
              return (
                <div
                  key={linha.date}
                  className="px-4 py-2 bg-sky-50/40 dark:bg-sky-900/20 flex items-center gap-2 text-sm"
                  title="Férias / atestado / abono / falta justificada — todos colapsam em 'Ajuste aprovado' por enquanto. Refinaremos em versão futura."
                >
                  <span className="text-sky-700 dark:text-sky-400">🏖</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300 tabular-nums">
                    {fmtDataBr(linha.date)}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400 capitalize text-[11px]">
                    · {diaDaSemana(linha.date)}
                  </span>
                  <span className="text-sky-700 dark:text-sky-400 text-xs ml-1">
                    Ajuste aprovado
                  </span>
                </div>
              );
            }
            if (linha.kind === "desconhecido") {
              return (
                <div
                  key={linha.date}
                  className="px-4 py-2 flex items-center gap-2 text-sm opacity-50"
                >
                  <span className="text-gray-400 dark:text-gray-600">—</span>
                  <span className="font-medium text-gray-500 dark:text-gray-400 tabular-nums">
                    {fmtDataBr(linha.date)}
                  </span>
                  <span className="text-gray-400 dark:text-gray-500 capitalize text-[11px]">
                    · {diaDaSemana(linha.date)}
                  </span>
                  <span className="text-gray-400 dark:text-gray-500 text-xs ml-1 italic">
                    Sem dados
                  </span>
                </div>
              );
            }
            const { date, exc } = linha;
            // Batidas do dia: vêm preenchidas pelo motor de regras (campo
            // novo `batidas`). Pegamos da primeira exception do dia que
            // tenha o campo. Caches antigos não têm o campo → fallback é
            // `undefined` e o header simplesmente não mostra (o `detail`
            // antigo continua aparecendo em cada linha por retrocompat).
            const batidasDoDia = exc.find((e) => e.batidas)?.batidas;
            // ── Dedupe: agrupa por ruleId (mesma regra no mesmo dia) ──
            type DedupExc = {
              ruleId: ExceptionRecord["ruleId"];
              count: number;
              first: ExceptionRecord;        // representante (1º) — pra texto/severidade
              all: ExceptionRecord[];        // pra tooltip com horários acumulados
            };
            const dedupMap = new Map<string, DedupExc>();
            for (const e of exc) {
              const cur = dedupMap.get(e.ruleId);
              if (cur) {
                cur.count += 1;
                cur.all.push(e);
              } else {
                dedupMap.set(e.ruleId, { ruleId: e.ruleId, count: 1, first: e, all: [e] });
              }
            }
            const dedupList = Array.from(dedupMap.values());
            const excAlinhamento = dedupList.filter(d => REGRA_CATEGORIA_DEFAULT[d.ruleId] === "alinhamento");
            const excAjuste = dedupList.filter(d => REGRA_CATEGORIA_DEFAULT[d.ruleId] === "ajuste");

            // Status efetivo por apontamento (combina map + fallback dia
            // legado). Spec: doc antigo "tratado"/"corrigido_solides" no
            // dia ⇒ todos os apontamentos do dia são tratados como
            // ciência implícita (sem criar docs novos retroativamente).
            const diaLegado = statusDiaMap?.get(`${grupo.empregadoId}_${date}`);
            const diaLegadoTerminal =
              diaLegado?.status === "tratado" || diaLegado?.status === "corrigido_solides";
            function statusEfetivoApontamento(ruleId: string): PontoApontamentoStatus {
              const doc = statusApontamentoMap.get(apontamentoKey(grupo.empregadoId, date, ruleId));
              if (doc) return doc.status;
              if (diaLegadoTerminal) return "ciencia";
              return "aberto";
            }

            // Agregado do dia: "X de Y tratados"
            const total = dedupList.length;
            const tratados = dedupList.filter(d => isStatusTerminal(statusEfetivoApontamento(d.ruleId))).length;
            const tudoTratado = total > 0 && tratados === total;

            return (
              <div
                key={date}
                className={`px-4 py-3 border-l-4 ${
                  tudoTratado
                    ? "border-l-emerald-500 bg-emerald-50/40 dark:bg-emerald-900/15"
                    : "border-l-amber-500"
                }`}
              >
                {/* Header do dia: data · dia · contador agregado + botão de atualizar */}
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 tabular-nums">
                    {fmtDataBr(date)}
                  </span>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400 capitalize">
                    · {diaDaSemana(date)}
                  </span>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">·</span>
                  <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-medium">
                    {exc.length} {exc.length === 1 ? "ocorrência" : "ocorrências"}
                  </span>
                  {tudoTratado ? (
                    <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 ml-1">
                      ✓ Tudo tratado
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 ml-1">
                      {tratados} de {total} tratados
                    </span>
                  )}
                  {(() => {
                    const refreshKey = `refresh:${grupo.empregadoId}_${date}`;
                    const carregando = salvandoApontamento.has(refreshKey);
                    return (
                      <button
                        type="button"
                        onClick={() => void onAtualizarDia(date)}
                        disabled={carregando}
                        className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800/60 disabled:opacity-50 disabled:cursor-wait whitespace-nowrap"
                        title="Re-puxa só esse dia desse empregado da Sólides (rápido, sub-segundo). Útil depois que o empregado corrigiu uma batida pra você conferir."
                      >
                        {carregando ? "⏳ atualizando…" : "🔄 atualizar este dia"}
                      </button>
                    );
                  })()}
                </div>
                {/* Batidas do dia — UMA vez no header. Cada linha de problema
                    abaixo fica enxuta (sem repetir batidas). Caches antigos
                    sem o campo `batidas` simplesmente não renderizam isso e
                    seguem mostrando o detail antigo em cada linha. */}
                {batidasDoDia && (
                  <div className="mb-3 px-3 py-1.5 rounded-md bg-gray-50 dark:bg-gray-800/40 border-l-4 border-l-indigo-500 text-xs">
                    <span className="text-gray-500 dark:text-gray-400 mr-2">📍 Batidas:</span>
                    <span className="font-mono text-gray-700 dark:text-gray-300">{batidasDoDia}</span>
                  </div>
                )}
                {/* Conteúdo: SEMPRE 2 colunas (Alinhamento × Ajuste) lado a lado. */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {/* Coluna Alinhamento */}
                  <div className={`rounded-lg border p-2.5 ${
                    excAlinhamento.length > 0
                      ? "border-amber-200 dark:border-amber-800/40 bg-amber-50/30 dark:bg-amber-900/10"
                      : "border-dashed border-gray-200 dark:border-gray-800 bg-transparent"
                  }`}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className={`text-[10px] uppercase tracking-wider font-bold ${
                        excAlinhamento.length > 0
                          ? "text-amber-700 dark:text-amber-400"
                          : "text-gray-400 dark:text-gray-600"
                      }`}>
                        🗣️ Alinhamento
                      </span>
                      <span className="text-[10px] text-gray-500 dark:text-gray-400 font-semibold">
                        ({excAlinhamento.length})
                      </span>
                    </div>
                    {excAlinhamento.length > 0 ? (
                      <ol className="space-y-1.5">
                        {renderDedupList(excAlinhamento, "alinhamento")}
                      </ol>
                    ) : (
                      <div className="text-[11px] text-gray-400 dark:text-gray-600 italic py-1">
                        Nada pra alinhar
                      </div>
                    )}
                  </div>
                  {/* Coluna Ajuste de batida */}
                  <div className={`rounded-lg border p-2.5 ${
                    excAjuste.length > 0
                      ? "border-rose-200 dark:border-rose-800/40 bg-rose-50/30 dark:bg-rose-900/10"
                      : "border-dashed border-gray-200 dark:border-gray-800 bg-transparent"
                  }`}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className={`text-[10px] uppercase tracking-wider font-bold ${
                        excAjuste.length > 0
                          ? "text-rose-700 dark:text-rose-400"
                          : "text-gray-400 dark:text-gray-600"
                      }`}>
                        ✏️ Ajuste de batida
                      </span>
                      <span className="text-[10px] text-gray-500 dark:text-gray-400 font-semibold">
                        ({excAjuste.length})
                      </span>
                    </div>
                    {excAjuste.length > 0 ? (
                      <ol className="space-y-1.5">
                        {renderDedupList(excAjuste, "ajuste")}
                      </ol>
                    ) : (
                      <div className="text-[11px] text-gray-400 dark:text-gray-600 italic py-1">
                        Nada pra ajustar
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );

            // Helper inline pra renderizar lista deduplicada com botão por
            // linha apropriado à categoria.
            function renderDedupList(
              listaDedup: DedupExc[],
              categoria: "alinhamento" | "ajuste",
            ) {
              return listaDedup.map((d, i) => {
                const e = d.first;
                const meta = RULES_META[e.ruleId];
                const sev = SEVERITY_INFO[e.severity];
                const ap = apontamentosPorChave.get(`${grupo.empregadoId}_${e.date}_${e.ruleId}`);
                const statusAp = statusEfetivoApontamento(e.ruleId);
                const isCiencia = statusAp === "ciencia";
                const isFalsoPositivo = statusAp === "nao_e_inconformidade";
                const isCorrigidoSolides = statusAp === "corrigido_solides";
                const isAguardandoAjuste = statusAp === "aguardando_ajuste";
                const isEmpresaAjustara = statusAp === "empresa_ajustara";
                const isTerminal = isStatusTerminal(statusAp);
                const lockKeyAtual = apontamentoKey(grupo.empregadoId, e.date, e.ruleId);
                const estaNoLote = !!loteDoEmpregado?.apontamentoChaves?.includes(lockKeyAtual);
                // Autor + data/hora da última ação de status (ciência, falso
                // positivo, corrigido, empresa resolverá…). Fonte primária: doc
                // de status por apontamento; fallback pro registro de ciência
                // gravado no próprio apontamento (fluxo legado).
                const statusDocAtual = statusApontamentoMap.get(lockKeyAtual);
                const autorAcao = statusDocAtual?.atualizadoPorNome ?? (isCiencia ? ap?.cienciaPorNome : undefined);
                const quandoAcao = statusDocAtual?.atualizadoEm ?? (isCiencia ? ap?.cienciaEm : undefined);
                // Tooltip detalhado quando count > 1 — lista detail/description
                const tooltipDetalhes = d.count > 1
                  ? d.all
                      .map((x, idx) => `${idx + 1}. ${x.detail || x.description}`)
                      .join("\n")
                  : undefined;
                return (
                  <li
                    key={`${e.ruleId}_${i}`}
                    className={`flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300 rounded-md px-1.5 py-1.5 ${
                      isTerminal
                        ? "bg-emerald-50/40 dark:bg-emerald-900/20 border-l-2 border-emerald-400 dark:border-emerald-600"
                        : ""
                    }`}
                  >
                    {/* Linha 1: número + chip + status badges + ações (alinhadas à direita) */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <span className="text-gray-400 dark:text-gray-500 tabular-nums select-none">
                          {i + 1}.
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap shrink-0 ${sev.badge}`}
                          title={meta.descricaoRegra}
                        >
                          {meta.icon} {meta.label}
                        </span>
                        {d.count > 1 && (
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-[10px] font-bold whitespace-nowrap shrink-0"
                            title={tooltipDetalhes || `${d.count} ocorrências dessa regra no dia`}
                          >
                            × {d.count}
                          </span>
                        )}
                        {isCiencia && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-semibold whitespace-nowrap"
                            title={`Ciência dada${ap?.cienciaPorNome ? ` por ${ap.cienciaPorNome}` : ""}`}
                          >
                            ✓ ciente
                          </span>
                        )}
                        {isFalsoPositivo && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200 font-semibold whitespace-nowrap"
                            title="Marcado como falso positivo"
                          >
                            ✓ falso positivo
                          </span>
                        )}
                        {isCorrigidoSolides && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100 font-bold whitespace-nowrap"
                            title="Corrigido no Sólides — sumiu na próxima atualização"
                          >
                            ✅ corrigido na Sólides
                          </span>
                        )}
                        {isAguardandoAjuste && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 font-semibold whitespace-nowrap"
                            title="Lote enviado — esperando o empregado ajustar na Sólides. Quando ele ajustar e a próxima atualização detectar que sumiu, vira 'Corrigido no Sólides' automaticamente."
                          >
                            📦 aguardando ajuste
                          </span>
                        )}
                        {isEmpresaAjustara && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200 font-semibold whitespace-nowrap"
                            title="A empresa vai resolver este ponto direto na Sólides (não foi solicitado ao empregado). Quando o ajuste aparecer no próximo report, vira 'Corrigido no Sólides' automaticamente."
                          >
                            🏢 empresa resolverá
                          </span>
                        )}
                        {/* Quem registrou a ação + quando (inline, sempre visível) */}
                        {(isTerminal || isAguardandoAjuste || isEmpresaAjustara) && autorAcao && (
                          <span
                            className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap"
                            title="Quem registrou esta ação e quando"
                          >
                            · {autorAcao}{quandoAcao ? ` · ${fmtDataHora(quandoAcao)}` : ""}
                          </span>
                        )}
                      </div>
                      {/* Wrapper das ações — alinhado à direita do header */}
                      <div className="flex items-center gap-1 shrink-0 ml-auto flex-wrap">
                        {(() => {
                          // Alerta administrativo só-leitura: sem botões. Some
                          // sozinho quando a pessoa sai do quadro do Sólides.
                          if (e.ruleId === "ativoNoSolidesAposDemissao") return null;
                          const lockKey = apontamentoKey(grupo.empregadoId, e.date, e.ruleId);
                          const salvando = salvandoApontamento.has(lockKey);
                          if (podeAnotar && !isTerminal && !isAguardandoAjuste && !isEmpresaAjustara) {
                            if (categoria === "alinhamento") {
                              return (
                                <>
                                  <button
                                    type="button"
                                    disabled={salvando}
                                    onClick={() => void onAplicarStatusApontamento(e, "ciencia")}
                                    className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 whitespace-nowrap disabled:opacity-50 disabled:cursor-wait"
                                    title="Dar ciência — registra o alinhamento (presencial). Conta como inconformidade real na Trilha do empregado."
                                  >
                                    {salvando ? "⏳ salvando…" : "👁 Dar ciência"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={salvando}
                                    onClick={() => void onAplicarStatusApontamento(e, "nao_e_inconformidade")}
                                    className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-gray-600 text-white hover:bg-gray-700 whitespace-nowrap disabled:opacity-50 disabled:cursor-wait"
                                    title={
                                      e.ruleId === "atrasoEntrada"
                                        ? "Não foi atraso — combinado/justificado previamente. Não conta na Trilha."
                                        : "Não é inconformidade — combinado/justificado. Não conta na Trilha."
                                    }
                                  >
                                    {salvando ? "⏳" : `✗ ${e.ruleId === "atrasoEntrada" ? "Não foi atraso" : "Não é inconformidade"}`}
                                  </button>
                                </>
                              );
                            }
                            // Ajuste de batida: 3 botões — Lote (toggle) + Empresa resolve + falso positivo
                            return (
                              <>
                                <button
                                  type="button"
                                  disabled={salvando}
                                  onClick={() => onToggleLote(e)}
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-md text-white whitespace-nowrap disabled:opacity-50 ${
                                    estaNoLote
                                      ? "bg-gray-500 hover:bg-gray-600"
                                      : "bg-amber-600 hover:bg-amber-700"
                                  }`}
                                  title={
                                    estaNoLote
                                      ? "Tirar este apontamento do lote de solicitação de ajuste deste empregado."
                                      : "Adicionar ao lote de solicitação de ajuste deste empregado."
                                  }
                                >
                                  {estaNoLote ? "↩ Tirar do lote" : "📦 + Lote"}
                                </button>
                                <button
                                  type="button"
                                  disabled={salvando}
                                  onClick={() => void onMarcarEmpresaResolve(e)}
                                  className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 whitespace-nowrap disabled:opacity-50 disabled:cursor-wait"
                                  title="A empresa vai resolver direto na Sólides — entra no box amarelo do lote (mas é filtrado da mensagem do WhatsApp do empregado)."
                                >
                                  {salvando ? "⏳" : "🏢 Empresa resolve"}
                                </button>
                                <button
                                  type="button"
                                  disabled={salvando}
                                  onClick={() => void onAplicarStatusApontamento(e, "nao_e_inconformidade")}
                                  className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-gray-600 text-white hover:bg-gray-700 whitespace-nowrap disabled:opacity-50 disabled:cursor-wait"
                                  title="Marcar como falso positivo — não é inconformidade."
                                >
                                  {salvando ? "⏳ salvando…" : "✗ Não é inconformidade"}
                                </button>
                              </>
                            );
                          }
                          return null;
                        })()}
                        {podeAnotar && (isAguardandoAjuste || isEmpresaAjustara) && (
                          <button
                            type="button"
                            disabled={salvandoApontamento.has(apontamentoKey(grupo.empregadoId, e.date, e.ruleId))}
                            onClick={() => {
                              // Empresa_ajustara: tira do lote E desmarca o status.
                              if (isEmpresaAjustara && estaNoLote) {
                                onToggleLote(e);
                              }
                              void onReabrirApontamento(e);
                            }}
                            className="text-[10px] text-gray-500 dark:text-gray-400 hover:underline whitespace-nowrap disabled:opacity-50 disabled:cursor-wait"
                            title={isEmpresaAjustara
                              ? "Desmarcar — sai do lote e volta o status a aberto"
                              : "Desmarcar — volta o apontamento pra aberto (sai do estado aguardando ajuste)"}
                          >
                            ↩ desmarcar
                          </button>
                        )}
                        {podeAnotar && isTerminal && (
                          <button
                            type="button"
                            disabled={salvandoApontamento.has(apontamentoKey(grupo.empregadoId, e.date, e.ruleId))}
                            onClick={() => void onReabrirApontamento(e)}
                            className="text-[10px] text-gray-500 dark:text-gray-400 hover:underline whitespace-nowrap disabled:opacity-50 disabled:cursor-wait"
                            title="Reabrir — volta o apontamento pra aberto"
                          >
                            ↩ reabrir
                          </button>
                        )}
                        {/* "💬 + nota" — adiciona nota interna ao apontamento.
                            Sempre habilitado (mesmo em estado terminal) pra o
                            líder registrar contexto retroativo. */}
                        {podeAnotar && (
                          <button
                            type="button"
                            onClick={() => {
                              const txt = prompt(
                                `Nota interna sobre ${meta?.label || e.ruleId} (${fmtDataBr(e.date)}):`,
                                "",
                              );
                              if (txt && txt.trim()) {
                                void onAdicionarNotaApontamento(e, txt);
                              }
                            }}
                            className="text-[10px] text-gray-500 dark:text-gray-400 hover:underline whitespace-nowrap"
                            title="Adicionar nota interna a este apontamento — fica registrada aqui pra contexto"
                          >
                            💬 + nota
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Linha 2: descrição em fonte menor, alinhada com o conteúdo (após o "N.") */}
                    <div
                      className="text-xs text-gray-500 dark:text-gray-400 pl-5 leading-snug"
                      title={tooltipDetalhes}
                    >
                      {e.description}
                      {(() => {
                        if (!e.detail) return null;
                        if (batidasDoDia) {
                          if (e.detail === batidasDoDia) return null;
                          if (e.detail.startsWith("🕐")) return null;
                          if (e.batidas && e.detail.includes(e.batidas)) return null;
                        }
                        return (
                          <span className="text-gray-400 dark:text-gray-500"> · {e.detail}</span>
                        );
                      })()}
                    </div>
                    {/* Linha 3 (opcional): notas internas associadas ao apontamento */}
                    {(() => {
                      const notasDoApontamento = notasPorApontamentoKey.get(`${e.date}_${e.ruleId}`);
                      if (!notasDoApontamento || notasDoApontamento.length === 0) return null;
                      return (
                        <ul className="pl-5 space-y-0.5 mt-0.5">
                          {notasDoApontamento.map((n) => (
                            <li
                              key={n.id}
                              className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300 italic leading-snug"
                            >
                              <span className="shrink-0">💬</span>
                              <span className="flex-1 min-w-0">{n.texto}</span>
                              <span
                                className="text-[10px] text-gray-400 dark:text-gray-500 not-italic shrink-0"
                                title={`${n.criadoPorNome} · ${fmtDataHora(n.criadoEm)}`}
                              >
                                {n.criadoPorNome.split(" ")[0]}
                              </span>
                              {podeAnotar && (
                                <button
                                  type="button"
                                  onClick={() => onApagarNota(n.id)}
                                  className="text-[10px] text-rose-500 hover:underline not-italic shrink-0"
                                  title="Apagar esta nota"
                                >
                                  ✕
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      );
                    })()}
                  </li>
                );
              });
            }
          });
        })()}
      </div>

      {/* Log do tratamento — timeline interna do que foi feito com o empregado
          nessa semana: envios via WhatsApp, ciências marcadas e notas manuais.
          NÃO VAI PRO EMPREGADO — é só pro registro interno (pra duas pessoas
          trabalharem no mesmo ponto sem se perder). */}
      {notas.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-800 bg-amber-50/40 dark:bg-amber-900/10 px-4 py-3">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-400 mb-1.5">
            📋 Log do tratamento ({notas.length}) — interno
          </div>
          <ul className="space-y-1.5">
            {[...notas]
              .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
              .map((n) => (
                <li key={n.id} className="flex items-start gap-2 text-[12px] text-gray-700 dark:text-gray-300">
                  <span className="text-gray-400 dark:text-gray-500 mt-0.5 shrink-0">
                    {n.origem === "envio_whatsapp" ? "📨" : n.origem === "ciencia" ? "👁" : "✍"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="whitespace-pre-wrap">{n.texto}</div>
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                      {n.criadoPorNome} · {fmtDataHora(n.criadoEm)}
                    </div>
                  </div>
                  {podeAnotar && n.origem === "manual" && (
                    <button
                      type="button"
                      onClick={() => onApagarNota(n.id)}
                      className="text-[10px] text-rose-600 dark:text-rose-400 hover:underline whitespace-nowrap"
                      title="Apagar nota interna"
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
      </>
      )}
    </section>
  );
}

function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
