// ════════════════════════════════════════════════════════════════════════════
//  Aba "Inconformidades" — compara as marcações de ponto reais (Sólides /
//  Tangerino) com a escala prevista cadastrada no Planejamento e lista as
//  não-conformidades. Casamento de colaborador por CPF.
//
//  Recebe rid + activeRestaurant da page-shell (RegistrosPontoPage).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { fmtAnoMes, pad2 } from "../../core/utils/date";
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
import { AREAS } from "../../core/types";
import { fetchPunches, type SolidesDebug } from "../../core/excecoes/solidesClient";
import {
  buildEscalaFromSolides,
  buildHorariosPrevistosFromSolides,
  fetchSolidesSchedules,
} from "../../core/excecoes/solidesScheduleClient";
import { fetchSolidesAdjustments, aplicarAjustesNaEscala } from "../../core/excecoes/solidesAdjustmentsClient";
import { onlyDigits } from "../../core/excecoes/dayMetrics";
import { semanasDoMes, type SemanaInfo } from "../../core/excecoes/semanas";
import {
  adicionarApontamento,
  adicionarNotaInterna,
  carregarStatusSemana,
  gerarApontamentosEscala,
  listarStatusDoRestaurante,
  marcarApontamentoCiencia,
  marcarApontamentosEnviados,
  marcarStatus,
  podeMarcarStatus,
  removerApontamento,
  removerNotaInterna,
  salvarRelatorioCache,
} from "../../core/excecoes/statusSemana";
import { montarMensagemAjustes, whatsLink } from "../../core/excecoes/whatsapp";
import { EXCECAO_STATUS_LABEL, type ExcecaoStatusSemana, type ExcecaoStatusValor } from "../../core/types";
import {
  generateExceptionsReport,
  type GenerateReportResult,
} from "../../core/excecoes/generateReport";
import { RULES_META } from "../../core/excecoes/rules";
import type {
  ExceptionRecord,
  ExceptionRuleId,
  ExceptionSeverity,
} from "../../core/excecoes/types";

// ─── Helpers de data ────────────────────────────────────────────────────────

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function firstDayOfCurrentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
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

// ─── Cores dos chips de semana conforme status do tratamento ───────────────
// aberto: cinza claro (default); em_tratamento: amarelo; tratado_lider: verde;
// conferido_gerente: azul. Quando ativo (chip selecionado), versão saturada.
const CHIP_COR_POR_STATUS: Record<ExcecaoStatusValor, { ativo: string; inativo: string }> = {
  aberto: {
    ativo:   "bg-indigo-600 text-white",
    inativo: "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700",
  },
  em_tratamento: {
    ativo:   "bg-amber-500 text-white",
    inativo: "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50",
  },
  tratado_lider: {
    ativo:   "bg-emerald-600 text-white",
    inativo: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/50",
  },
  conferido_gerente: {
    ativo:   "bg-sky-600 text-white",
    inativo: "bg-sky-100 dark:bg-sky-900/30 text-sky-800 dark:text-sky-300 hover:bg-sky-200 dark:hover:bg-sky-900/50",
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
  // Default: semana que contém hoje (se mês corrente) ou 1ª semana (se outro mês)
  const [semanaIdx, setSemanaIdx] = useState<number>(() => {
    const s = semanasMes.find((w) => w.containsToday);
    return s ? s.index : 1;
  });
  const semanaAtiva = semanasMes.find((w) => w.index === semanaIdx) || semanasMes[0];
  const startDate = semanaAtiva?.weekStart || firstDayOfCurrentMonth();
  const endDate = semanaAtiva?.weekEnd || todayYmd();

  // Status da semana selecionada (persistido em /excecoesStatusSemana)
  const [statusSemana, setStatusSemana] = useState<ExcecaoStatusSemana | null>(null);
  const [carregandoStatus, setCarregandoStatus] = useState(false);
  const [showHistoricoStatus, setShowHistoricoStatus] = useState(false);

  // Status DE TODAS as semanas do mês — alimenta a cor dos chips. Recarregado
  // quando muda o mês ou quando o status da semana ativa muda.
  const [statusPorWeekStart, setStatusPorWeekStart] = useState<Map<string, ExcecaoStatusValor>>(new Map());
  useEffect(() => {
    if (!rid) return;
    let cancelled = false;
    listarStatusDoRestaurante(rid)
      .then((rows) => {
        if (cancelled) return;
        const m = new Map<string, ExcecaoStatusValor>();
        for (const r of rows) m.set(r.weekStart, r.status);
        setStatusPorWeekStart(m);
      })
      .catch(() => { if (!cancelled) setStatusPorWeekStart(new Map()); });
    return () => { cancelled = true; };
  }, [rid, anoMes.ano, anoMes.mes, statusSemana?.status]);

  // Carrega status da semana selecionada. Quando muda de semana, ZERA o
  // relatório atualmente exibido — depois, se a semana já tem cache salvo
  // (porque está em tratamento+), restaura o snapshot.
  useEffect(() => {
    if (!rid || !semanaAtiva) return;
    let cancelled = false;
    // Reset visual imediato
    setStatusSemana(null);
    setResult(null);
    setDebug(null);
    setEscalaDebug(null);
    setErro("");
    setFiltroColaborador("");
    setFiltroRegra("");
    setFiltroSeveridade("");
    setCarregandoStatus(true);
    carregarStatusSemana(rid, semanaAtiva.weekStart)
      .then((s) => {
        if (cancelled) return;
        setStatusSemana(s);
        // Restaura relatório cacheado (só faz sentido se semana está em
        // tratamento+, mas o cache só é salvo nesses casos, então confia)
        if (s?.relatorioCache) {
          const c = s.relatorioCache;
          setResult({
            exceptions: c.exceptions as ExceptionRecord[],
            unmatched: c.unmatched as GenerateReportResult["unmatched"],
            diasAnalisados: c.diasAnalisados,
          });
        }
      })
      .catch(() => { if (!cancelled) setStatusSemana(null); })
      .finally(() => { if (!cancelled) setCarregandoStatus(false); });
    return () => { cancelled = true; };
  }, [rid, semanaAtiva?.weekStart]);

  // Auto-gerar relatório ao entrar numa semana SEM cache. Roda uma vez por
  // chip — depois disso, o botão "🔄 Atualizar" toca de novo manualmente.
  // Precisa esperar empregados estarem carregados (senão dá relatório vazio).
  const autoGeradoParaSemana = useRef<string | null>(null);
  useEffect(() => {
    if (!semanaAtiva || !rid || empregados.length === 0) return;
    if (carregandoStatus) return; // espera o load do status terminar
    // Tem cache → não gera (restaurar é responsabilidade do outro useEffect)
    if (statusSemana?.relatorioCache) return;
    // Já tentou auto-gerar essa semana nessa sessão → não repete
    if (autoGeradoParaSemana.current === semanaAtiva.weekStart) return;
    autoGeradoParaSemana.current = semanaAtiva.weekStart;
    void gerar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semanaAtiva?.weekStart, rid, empregados.length, carregandoStatus, statusSemana?.relatorioCache]);

  function navegaMes(delta: number) {
    setAnoMes((cur) => {
      const d = new Date(cur.ano, cur.mes - 1 + delta, 1);
      return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
    });
    setSemanaIdx(1);
  }

  async function aplicarStatus(novoStatus: ExcecaoStatusValor) {
    if (!me || !semanaAtiva) return;
    const statusAtual = statusSemana?.status || "aberto";
    if (!podeMarcarStatus(me, rid, novoStatus, statusAtual)) {
      alert("Sem permissão pra marcar esse status.");
      return;
    }
    // Pede observação quando líder coloca em tratamento (anotando o que vai
    // ajustar) ou quando reverte (justificativa).
    const ehRegressao =
      (statusAtual === "conferido_gerente" && novoStatus !== "conferido_gerente") ||
      (statusAtual === "tratado_lider"     && novoStatus === "em_tratamento")    ||
      (statusAtual === "em_tratamento"     && novoStatus === "aberto");
    let obs: string | undefined;
    if (novoStatus === "em_tratamento" && !ehRegressao) {
      obs = prompt("Observação (opcional) — o que foi pedido pra ajustar?") || undefined;
    } else if (ehRegressao) {
      const r = prompt("Por que você está revertendo? (opcional)");
      obs = r ? `[reverter] ${r}` : undefined;
    }
    try {
      let updated = await marcarStatus(rid, semanaAtiva.weekStart, semanaAtiva.weekEnd, novoStatus, me, obs);
      // Ao iniciar tratamento (saída de "aberto"), congelar o relatório
      // atual no doc pra manter memória entre sessões.
      if (statusAtual === "aberto" && novoStatus !== "aberto" && result) {
        try {
          updated = await salvarRelatorioCache(
            rid,
            semanaAtiva.weekStart,
            semanaAtiva.weekEnd,
            {
              geradoEm: new Date().toISOString(),
              exceptions: result.exceptions,
              unmatched: result.unmatched,
              diasAnalisados: result.diasAnalisados,
            },
          );
        } catch (e) {
          console.error("Erro salvando cache do relatório no início do tratamento:", e);
          alert("Status atualizado, mas o cache do relatório não foi salvo: " + (e instanceof Error ? e.message : "?"));
        }
      }
      // Ao confirmar conferência do gerente, gera o relatório de Apontamentos
      // de Escala a partir do snapshot do relatório de inconformidades.
      // Preserva o status "ajustado" de itens equivalentes existentes (caso
      // tenha sido reaberto e re-conferido).
      if (novoStatus === "conferido_gerente") {
        try {
          updated = await gerarApontamentosEscala(
            rid,
            semanaAtiva.weekStart,
            semanaAtiva.weekEnd,
          );
        } catch (e) {
          console.error("Erro gerando Apontamentos de Escala:", e);
          alert("Conferência salva, mas falhou ao gerar apontamentos de escala: " + (e instanceof Error ? e.message : "?"));
        }
      }
      setStatusSemana(updated);
    } catch (e) {
      alert("Erro ao salvar status: " + (e instanceof Error ? e.message : "?"));
    }
  }

  // ─── Apontamentos por empregado ────────────────────────────────────────────
  // O líder marca os checkboxes em cada inconformidade pra criar apontamentos
  // (status="pendente"). Ao disparar o WhatsApp, viram "enviado". Pra
  // apontamentos não-tratáveis (intervalo a menos passado), o líder clica em
  // "Ciência" → status="ciencia" (fica registrado mas não vai pro empregado).
  // Anotações livres viram NOTAS INTERNAS (não vão pro WhatsApp).
  const semanaConferida = statusSemana?.status === "conferido_gerente";

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

  // Resolve o apontamento existente (se houver) pra uma inconformidade,
  // identificado pela tripla (empregadoId, data, ruleId).
  function acharApontamento(empregadoId: string, data: string, ruleId: string) {
    return (statusSemana?.apontamentos || []).find(
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
    if (!me || !semanaAtiva) return;
    if (semanaConferida) {
      alert("Semana já conferida — não dá pra mexer em apontamento.");
      return;
    }
    const empId = resolverEmpId(exc);
    if (!empId) return;
    const existente = acharApontamento(empId, exc.date, exc.ruleId);
    try {
      if (existente && existente.status === "pendente") {
        // Desmarca pendente → remove
        const updated = await removerApontamento(rid, semanaAtiva.weekStart, semanaAtiva.weekEnd, existente.id);
        setStatusSemana(updated);
      } else if (existente) {
        // Já enviado/ciência → não toca (use botão dedicado pra reabrir)
        alert(
          existente.status === "enviado"
            ? `Empregado já avisado em ${existente.enviadoEm ? fmtDataHora(existente.enviadoEm) : "?"}. Pra reabrir, use o botão "↩ reabrir".`
            : `Já marcado como ciência por ${existente.cienciaPorNome}. Pra reabrir, use o botão "↩ reabrir".`,
        );
      } else {
        const updated = await adicionarApontamento(
          rid,
          semanaAtiva.weekStart,
          semanaAtiva.weekEnd,
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
        setStatusSemana(updated);
      }
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  }

  // Marca a inconformidade como "ciência" — fica registrado mas NÃO vai pro
  // WhatsApp (caso clássico: intervalo a menos que já passou, fica só pra log).
  async function darCienciaExcecao(exc: ExceptionRecord) {
    if (!me || !semanaAtiva) return;
    if (semanaConferida) {
      alert("Semana já conferida — não dá pra mexer em apontamento.");
      return;
    }
    const empId = resolverEmpId(exc);
    if (!empId) return;
    const existente = acharApontamento(empId, exc.date, exc.ruleId);
    try {
      let apontamentoId: string;
      if (existente) {
        const updated = await marcarApontamentoCiencia(
          rid,
          semanaAtiva.weekStart,
          semanaAtiva.weekEnd,
          existente.id,
          me,
        );
        apontamentoId = existente.id;
        setStatusSemana(updated);
      } else {
        const updated = await adicionarApontamento(
          rid,
          semanaAtiva.weekStart,
          semanaAtiva.weekEnd,
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
        // Pega o id que acabou de criar (último apontamento)
        apontamentoId = (updated.apontamentos || []).slice(-1)[0]?.id || "";
        setStatusSemana(updated);
      }
      // Cria nota interna automática registrando a ciência → timeline completa
      try {
        const updated = await adicionarNotaInterna(
          rid,
          semanaAtiva.weekStart,
          semanaAtiva.weekEnd,
          {
            empregadoId: empId,
            empregadoNome: exc.employeeName,
            texto: `👁 Ciência tomada (não-tratável retroativo): ${gerarTextoApontamento(exc)}`,
            origem: "ciencia",
            apontamentoIds: [apontamentoId],
          },
          me,
        );
        setStatusSemana(updated);
      } catch (e) {
        console.warn("Erro criando nota auto de ciência:", e);
      }
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  }

  // Reabre apontamento finalizado (enviado ou ciência) → vira pendente.
  // Remove o apontamento — próxima ação do líder cria de novo se quiser.
  async function reabrirExcecao(exc: ExceptionRecord) {
    if (!me || !semanaAtiva) return;
    if (semanaConferida) return;
    const empId = resolverEmpId(exc);
    if (!empId) return;
    const existente = acharApontamento(empId, exc.date, exc.ruleId);
    if (!existente) return;
    if (!confirm("Reabrir esse apontamento? Vai voltar pra pendente.")) return;
    try {
      const updated = await removerApontamento(
        rid,
        semanaAtiva.weekStart,
        semanaAtiva.weekEnd,
        existente.id,
      );
      setStatusSemana(updated);
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  }

  // Map (empregadoId_data_ruleId) → apontamento existente. Alimenta a UI pra
  // saber o status visual e o botão a renderizar.
  const apontamentosPorChave = useMemo(() => {
    const m = new Map<string, ApontamentoFuncionario>();
    for (const a of statusSemana?.apontamentos || []) {
      if (a.origem === "inconformidade" && a.ruleId && a.data) {
        m.set(`${a.empregadoId}_${a.data}_${a.ruleId}`, a);
      }
    }
    return m;
  }, [statusSemana?.apontamentos]);

  // Nota INTERNA sobre o empregado (não vai pro WhatsApp). Tipo: "já conversei
  // pessoalmente", "veio explicar que foi atestado", "deixei recado pra ele".
  async function criarNotaInterna(empregadoId: string, empregadoNome: string, cpf?: string) {
    if (!me || !semanaAtiva) return;
    if (semanaConferida) {
      alert("Semana já conferida — não dá pra adicionar nota.");
      return;
    }
    if (!empregadoId) {
      alert(`Não achei empregado com CPF ${cpf || "?"} no Planejamento.`);
      return;
    }
    const txt = prompt(
      `Nota INTERNA sobre ${empregadoNome} (não vai pro WhatsApp — só pro nosso registro):`,
      "",
    );
    if (!txt || !txt.trim()) return;
    try {
      const updated = await adicionarNotaInterna(
        rid,
        semanaAtiva.weekStart,
        semanaAtiva.weekEnd,
        { empregadoId, empregadoNome, texto: txt.trim(), origem: "manual" },
        me,
      );
      setStatusSemana(updated);
    } catch (e) {
      alert("Erro ao salvar nota: " + (e instanceof Error ? e.message : "?"));
    }
  }

  async function apagarNotaInterna(notaId: string) {
    if (!me || !semanaAtiva) return;
    if (semanaConferida) return;
    if (!confirm("Apagar essa nota interna?")) return;
    try {
      const updated = await removerNotaInterna(
        rid,
        semanaAtiva.weekStart,
        semanaAtiva.weekEnd,
        notaId,
      );
      setStatusSemana(updated);
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  }

  // Agrupa notas internas por empregado
  const notasPorEmpregado = useMemo(() => {
    const m = new Map<string, NotaInterna[]>();
    for (const n of statusSemana?.notasInternas || []) {
      const arr = m.get(n.empregadoId) || [];
      arr.push(n);
      m.set(n.empregadoId, arr);
    }
    return m;
  }, [statusSemana?.notasInternas]);

  // Conta os apontamentos `pendente` por empregado — alimenta o badge "(N)" do
  // botão "Enviar via WhatsApp".
  const pendentesPorEmpregado = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of statusSemana?.apontamentos || []) {
      if (a.status === "pendente") m.set(a.empregadoId, (m.get(a.empregadoId) || 0) + 1);
    }
    return m;
  }, [statusSemana?.apontamentos]);

  // Envia em UMA mensagem todos os apontamentos `pendente` do empregado e:
  // 1. Marca eles como `enviado` (com enviadoEm)
  // 2. Cria uma NOTA INTERNA automática registrando o envio (data + itens) —
  //    isso fica no histórico interno pra "empregado avisado no dia X com
  //    apontamentos Y, Z..."
  async function enviarWhatsDoEmpregado(empregadoId: string, empregadoNome: string) {
    if (!me || !semanaAtiva || !statusSemana) return;
    const pendentes = (statusSemana.apontamentos || []).filter(
      (a) => a.empregadoId === empregadoId && a.status === "pendente",
    );
    if (pendentes.length === 0) {
      alert("Marque pelo menos 1 inconformidade pra enviar.");
      return;
    }
    const whatsapp = whatsByEmpId.get(empregadoId);
    if (!whatsapp) {
      alert(`${empregadoNome} não tem WhatsApp cadastrado em Pessoas.`);
      return;
    }
    const msg = montarMensagemAjustes({
      empregadoNome,
      restNome: activeRestaurant.nome,
      weekStart: semanaAtiva.weekStart,
      weekEnd: semanaAtiva.weekEnd,
      apontamentos: pendentes,
    });
    const link = whatsLink(whatsapp, msg);
    if (!link) {
      alert(`WhatsApp de ${empregadoNome} inválido (precisa ter DDD + número).`);
      return;
    }
    window.open(link, "_blank");
    try {
      // 1. Marca como enviado
      await marcarApontamentosEnviados(
        rid,
        semanaAtiva.weekStart,
        semanaAtiva.weekEnd,
        pendentes.map((a) => a.id),
      );
      // 2. Cria nota interna automática registrando o envio
      const resumoItens = pendentes
        .map((a, i) => `${i + 1}. ${a.texto}`)
        .join("\n");
      const updated = await adicionarNotaInterna(
        rid,
        semanaAtiva.weekStart,
        semanaAtiva.weekEnd,
        {
          empregadoId,
          empregadoNome,
          texto: `📨 Empregado avisado via WhatsApp em ${fmtDataHora(new Date().toISOString())} com ${pendentes.length} apontamento(s):\n${resumoItens}`,
          origem: "envio_whatsapp",
          apontamentoIds: pendentes.map((a) => a.id),
        },
        me,
      );
      setStatusSemana(updated);
    } catch (e) {
      console.warn("Erro pós-envio:", e);
    }
  }

  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const [result, setResult] = useState<GenerateReportResult | null>(null);
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

  // Filtros da tabela
  const [filtroColaborador, setFiltroColaborador] = useState("");
  const [filtroRegra, setFiltroRegra] = useState<ExceptionRuleId | "">("");
  const [filtroSeveridade, setFiltroSeveridade] = useState<ExceptionSeverity | "">("");

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

  const [filtroArea, setFiltroArea] = useState<Area | "">("");

  async function gerar() {
    if (!rid) return;
    if (!startDate || !endDate) {
      setErro("Informe o período (data inicial e final).");
      return;
    }
    if (startDate > endDate) {
      setErro("A data inicial não pode ser depois da final.");
      return;
    }
    setLoading(true);
    setErro("");
    setResult(null);
    try {
      const shortCode = activeRestaurant?.shortCode || "";
      const { punches, debug: dbg } = await fetchPunches(startDate, endDate, shortCode);

      // Escala vinda da Sólides (fonte primária). Pra cada empregado do
      // Planejamento que tenha CPF, busca o sid Sólides e o quadro do meio
      // do mês — usado como template recorrente pro range todo.
      let escalaPorEmpregado: Record<string, Record<string, import("../../core/types").ScheduleStatus>> = {};
      let horariosPrevistos: Record<string, Record<string, { in: string; out: string }>> = {};
      const debugInfo: EscalaDebugInfo = {};
      try {
        // Várias datas em ordem de prioridade — workaround pro bug da Sólides
        // que às vezes retorna null pra uma data específica mesmo o quadro
        // existindo. Tenta endDate, depois meio, depois startDate, depois hoje.
        const datasTry = [endDate, midDate(startDate, endDate), startDate, todayYmd()];
        const schedRes = await fetchSolidesSchedules(datasTry, shortCode);
        const sidByCpf = new Map<string, number>();
        for (const e of schedRes.employees) {
          if (e.cpf) sidByCpf.set(e.cpf, e.id);
        }
        const empIdByCpf = new Map<string, string>();
        for (const e of empregados) {
          if (e.cpf) empIdByCpf.set(onlyDigits(e.cpf), e.id);
        }
        escalaPorEmpregado = buildEscalaFromSolides(
          schedRes.schedules, sidByCpf, empIdByCpf, startDate, endDate,
        );
        // Horários previstos por data (alimenta a regra de atraso)
        horariosPrevistos = buildHorariosPrevistosFromSolides(
          schedRes.schedules, sidByCpf, empIdByCpf, startDate, endDate,
        );
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
      }

      // Fallback / merge: pra empregados que NÃO tiveram escala vinda da
      // Sólides (sem CPF, sem quadro), usa a escala do Planejamento.
      const fallback = await buildEscalaContext(empregados, rid, startDate, endDate);
      for (const [empId, perDate] of Object.entries(fallback)) {
        if (!escalaPorEmpregado[empId]) {
          escalaPorEmpregado[empId] = perDate;
        }
      }

      // Ajustes aprovados (FOLGA, ATESTADO, ABONO, FÉRIAS, etc) sobrescrevem
      // dias da escala oficial pra "folga" — evita falsos positivos de "Falta
      // sem ajuste" em dias em que o RH justificou ausência. Falta NÃO
      // justificada é deixada como "trabalho" pra a regra continuar disparando.
      try {
        const [y1, m1, d1] = startDate.split("-").map(Number);
        const [y2, m2, d2] = endDate.split("-").map(Number);
        const startMs = Date.UTC(y1, m1 - 1, d1, 0, 0, 0, 0);
        const endMs   = Date.UTC(y2, m2 - 1, d2, 23, 59, 59, 999);
        const adjRes = await fetchSolidesAdjustments(startMs, endMs, shortCode);
        // mapa empregadoId Planejamento → sid Sólides
        const sidByCpfMap = new Map<string, number>();
        for (const e of adjRes.employees) {
          if (e.cpf) sidByCpfMap.set(e.cpf, e.id);
        }
        const sidByEmpId: Record<string, number> = {};
        for (const emp of empregados) {
          const c = onlyDigits(emp.cpf);
          const sid = c ? sidByCpfMap.get(c) : undefined;
          if (sid != null) sidByEmpId[emp.id] = sid;
        }
        aplicarAjustesNaEscala(adjRes.adjustments, sidByEmpId, escalaPorEmpregado);
        debugInfo.ajustesAplicados = adjRes.count;
        debugInfo.sampleProbeAdj = adjRes.sampleProbe;
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
        escalaPorEmpregado,
        horariosPrevistos,
        startDate,
        endDate,
      });
      setResult(report);
      setDebug(dbg || null);
      // Reseta filtros
      setFiltroColaborador("");
      setFiltroRegra("");
      setFiltroSeveridade("");

      // Salva o snapshot no doc da semana SEMPRE — assim o líder pode gerar,
      // sair, e voltar depois sem perder o que já tinha visto. Ao mudar pra
      // "em_tratamento", o cache vira o ponto de partida do tratamento.
      if (semanaAtiva) {
        try {
          const updated = await salvarRelatorioCache(
            rid,
            semanaAtiva.weekStart,
            semanaAtiva.weekEnd,
            {
              geradoEm: new Date().toISOString(),
              exceptions: report.exceptions,
              unmatched: report.unmatched,
              diasAnalisados: report.diasAnalisados,
            },
            me || undefined, // registra evento no histórico se semana já estiver em tratamento
          );
          setStatusSemana(updated);
        } catch (e) {
          console.error("Erro salvando cache do relatório:", e);
          alert("Relatório gerado mas o cache não foi salvo: " + (e instanceof Error ? e.message : "?"));
        }
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao gerar o relatório.");
    } finally {
      setLoading(false);
    }
  }

  // Lista de colaboradores que aparecem nas exceções (pro filtro)
  const colaboradoresNasExcecoes = useMemo(() => {
    if (!result) return [];
    const nomes = new Set(result.exceptions.map((e) => e.employeeName));
    return [...nomes].sort((a, b) => a.localeCompare(b));
  }, [result]);

  // Exceções após aplicar filtros
  const excecoesFiltradas = useMemo(() => {
    if (!result) return [];
    return result.exceptions.filter((e) => {
      if (filtroArea) {
        // Resolve área pelo CPF → empregadoId Planejamento → área do cargo.
        const cpfD = (e.cpf || "").replace(/\D/g, "");
        const empId = empIdByCpf.get(cpfD);
        const area = empId ? areaByEmpId.get(empId) : undefined;
        if (area !== filtroArea) return false;
      }
      if (filtroColaborador && e.employeeName !== filtroColaborador) return false;
      if (filtroRegra && e.ruleId !== filtroRegra) return false;
      if (filtroSeveridade && e.severity !== filtroSeveridade) return false;
      return true;
    });
  }, [result, filtroArea, filtroColaborador, filtroRegra, filtroSeveridade, areaByEmpId, empIdByCpf]);

  // Contagem por severidade (do total, não do filtrado)
  const resumo = useMemo(() => {
    const base = { grave: 0, aviso: 0, info: 0 };
    if (!result) return base;
    for (const e of result.exceptions) base[e.severity] += 1;
    return base;
  }, [result]);

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
                setSemanaIdx(semanasDoMes(h.getFullYear(), h.getMonth() + 1).find((w) => w.containsToday)?.index || 1);
              }}
              className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline ml-1"
            >hoje</button>
          </div>
        </div>

        {/* Chips de semana — cor reflete o status do tratamento:
            aberto → cinza claro; em_tratamento → amarelo; tratado_lider →
            verde; conferido_gerente → azul.
            O último chip é "🔄 Atualizar" — força regerar via Sólides
            (auto-gera é por semana na 1ª visita; depois é manual). */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {semanasMes.map((w) => {
            const ativo = w.index === semanaIdx;
            const status = statusPorWeekStart.get(w.weekStart) || "aberto";
            const cor = CHIP_COR_POR_STATUS[status];
            return (
              <button
                key={w.index}
                type="button"
                onClick={() => setSemanaIdx(w.index)}
                className={`text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full transition-colors ${
                  ativo ? cor.ativo : cor.inativo
                } ${w.containsToday && !ativo ? "ring-1 ring-indigo-400 dark:ring-indigo-500" : ""}`}
                title={`${w.weekStart} a ${w.weekEnd} · ${EXCECAO_STATUS_LABEL[status]}`}
              >
                {w.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={gerar}
            disabled={loading || empregados.length === 0}
            className="ml-auto text-[11px] uppercase tracking-wider font-semibold px-3 py-1 rounded-full transition-colors bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title={statusSemana?.relatorioCache ? "Atualizar pela Sólides (sobrescreve o cache)" : "Gerar relatório dessa semana"}
          >
            {loading ? "⏳ atualizando…" : "🔄 Atualizar"}
          </button>
        </div>

        {empregados.length === 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Nenhum empregado cadastrado neste restaurante — cadastre em Pessoas pra poder casar as
            marcações.
          </p>
        )}
      </div>

      {/* ── Card de Status da Semana (workflow líder → gerente) ── */}
      <StatusSemanaCard
        statusSemana={statusSemana}
        carregando={carregandoStatus}
        semanaAtiva={semanaAtiva}
        temRelatorio={!!result}
        podeMarcar={(s) => podeMarcarStatus(me, rid, s, statusSemana?.status || "aberto")}
        onMarcar={aplicarStatus}
        showHistorico={showHistoricoStatus}
        onToggleHistorico={() => setShowHistoricoStatus((v) => !v)}
      />

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

      {result && !loading && (
        <>
          {/* ── Resumo ── */}
          <div className="flex flex-wrap gap-3 mb-4">
            <ResumoCard
              label="Total de exceções"
              value={result.exceptions.length}
              color="text-gray-900 dark:text-gray-100"
            />
            <ResumoCard label="Graves" value={resumo.grave} color="text-rose-600 dark:text-rose-400" />
            <ResumoCard label="Avisos" value={resumo.aviso} color="text-amber-600 dark:text-amber-400" />
            <ResumoCard label="Info" value={resumo.info} color="text-sky-600 dark:text-sky-400" />
            <ResumoCard
              label="Dias analisados"
              value={result.diasAnalisados}
              color="text-gray-500 dark:text-gray-400"
            />
          </div>

          {/* ── Aviso de não-casados ── */}
          {result.unmatched.length > 0 && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-300 mb-4">
              <strong>
                ⚠ {result.unmatched.length} colaborador(es) da Sólides sem empregado correspondente
                no Planejamento
              </strong>{" "}
              (CPF não bateu). As marcações deles foram ignoradas:
              <ul className="mt-1 ml-4 list-disc text-xs">
                {result.unmatched.slice(0, 10).map((u) => (
                  <li key={u.cpf || u.nome}>
                    {u.nome} {u.cpf ? `(CPF ${u.cpf})` : "(sem CPF na Sólides)"} — {u.dias} dia(s)
                  </li>
                ))}
                {result.unmatched.length > 10 && <li>… e mais {result.unmatched.length - 10}</li>}
              </ul>
            </div>
          )}

          {/* ── Filtros ── */}
          <div className="flex flex-wrap gap-2 mb-3">
            <select
              value={filtroArea}
              onChange={(e) => setFiltroArea(e.target.value as Area | "")}
              className="px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-semibold"
              title="Filtra por área (cada líder vê só a sua)"
            >
              <option value="">🗂️ Todas as áreas</option>
              {areasDisponiveis.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              value={filtroColaborador}
              onChange={(e) => setFiltroColaborador(e.target.value)}
              className="px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            >
              <option value="">👤 Todos os colaboradores</option>
              {colaboradoresNasExcecoes.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <select
              value={filtroRegra}
              onChange={(e) => setFiltroRegra(e.target.value as ExceptionRuleId | "")}
              className="px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            >
              <option value="">🏷️ Todos os tipos</option>
              {Object.values(RULES_META).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.icon} {m.label}
                </option>
              ))}
            </select>
            <select
              value={filtroSeveridade}
              onChange={(e) => setFiltroSeveridade(e.target.value as ExceptionSeverity | "")}
              className="px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            >
              <option value="">🚦 Todas as severidades</option>
              <option value="grave">Grave</option>
              <option value="aviso">Aviso</option>
              <option value="info">Info</option>
            </select>
            <span className="text-xs text-gray-500 dark:text-gray-400 self-center">
              {excecoesFiltradas.length} de {result.exceptions.length}
            </span>
          </div>

          {/* ── Lista agrupada por colaborador → data ── */}
          {result.exceptions.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
              <div className="text-4xl mb-3">✅</div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">
                Nenhuma exceção no período
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Marcações e escala bateram sem não-conformidades.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {agruparPorColabDate(excecoesFiltradas, empIdByCpf).map((grupo) => (
                <ColaboradorBlock
                  key={grupo.key}
                  grupo={grupo}
                  podeAnotar={!semanaConferida}
                  pendentesCount={pendentesPorEmpregado.get(grupo.empregadoId) || 0}
                  temWhatsapp={!!whatsByEmpId.get(grupo.empregadoId)}
                  apontamentosPorChave={apontamentosPorChave}
                  notas={notasPorEmpregado.get(grupo.empregadoId) || []}
                  onToggleEnviar={toggleEnviarExcecao}
                  onCiencia={darCienciaExcecao}
                  onReabrir={reabrirExcecao}
                  onAnotacaoLivre={() => criarNotaInterna(grupo.empregadoId, grupo.nome, grupo.cpf)}
                  onEnviarWhats={() => enviarWhatsDoEmpregado(grupo.empregadoId, grupo.nome)}
                  onApagarNota={apagarNotaInterna}
                />
              ))}
            </div>
          )}
        </>
      )}

      {!result && !loading && (
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
    </div>
  );
}

function ResumoCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 min-w-[120px]">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </div>
    </div>
  );
}

// ─── Agrupamento Colaborador → Data → exceções ─────────────────────────────
type GrupoColab = {
  key: string;
  empregadoId: string;
  nome: string;
  cpf: string;
  totalExc: number;
  totalGraves: number;
  porData: { date: string; exc: ExceptionRecord[] }[];
};

// `empIdByCpf` resolve o ID do Planejamento (string) — exc.employeeId é o
// ID da Sólides (number), inadequado pra ancorar apontamentos.
function agruparPorColabDate(
  rows: ExceptionRecord[],
  empIdByCpf: Map<string, string>,
): GrupoColab[] {
  type Acc = {
    empregadoId: string;
    nome: string;
    cpf: string;
    porData: Map<string, ExceptionRecord[]>;
  };
  const map = new Map<string, Acc>();
  for (const e of rows) {
    const cpfD = (e.cpf || "").replace(/\D/g, "");
    const empId = empIdByCpf.get(cpfD) ?? "";
    const k = `${e.employeeId}_${e.cpf}`;
    let g = map.get(k);
    if (!g) {
      g = { empregadoId: empId, nome: e.employeeName, cpf: e.cpf, porData: new Map() };
      map.set(k, g);
    }
    const arr = g.porData.get(e.date) ?? [];
    arr.push(e);
    g.porData.set(e.date, arr);
  }
  return Array.from(map.entries())
    .map<GrupoColab>(([key, g]) => {
      const porData = Array.from(g.porData.entries())
        .map(([date, exc]) => ({ date, exc }))
        .sort((a, b) => a.date.localeCompare(b.date));
      const total = porData.reduce((s, d) => s + d.exc.length, 0);
      const graves = porData.reduce(
        (s, d) => s + d.exc.filter((e) => e.severity === "grave").length,
        0,
      );
      return { key, empregadoId: g.empregadoId, nome: g.nome, cpf: g.cpf, totalExc: total, totalGraves: graves, porData };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome));
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
  podeAnotar,
  pendentesCount,
  temWhatsapp,
  apontamentosPorChave,
  notas,
  onToggleEnviar,
  onCiencia,
  onReabrir,
  onAnotacaoLivre,
  onEnviarWhats,
  onApagarNota,
}: {
  grupo: GrupoColab;
  podeAnotar: boolean;
  pendentesCount: number;
  temWhatsapp: boolean;
  apontamentosPorChave: Map<string, ApontamentoFuncionario>;
  notas: NotaInterna[];
  onToggleEnviar: (exc: ExceptionRecord) => void;
  onCiencia: (exc: ExceptionRecord) => void;
  onReabrir: (exc: ExceptionRecord) => void;
  onAnotacaoLivre: () => void;
  onEnviarWhats: () => void;
  onApagarNota: (notaId: string) => void;
}) {
  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <header className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between flex-wrap gap-2">
        <div className="min-w-0">
          <div className="font-bold text-gray-900 dark:text-gray-100">{grupo.nome}</div>
          {grupo.cpf && (
            <div className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">
              CPF {fmtCpf(grupo.cpf)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] flex-wrap">
          <span className="px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold">
            {grupo.totalExc} exc.
          </span>
          {grupo.totalGraves > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 font-semibold">
              {grupo.totalGraves} grave(s)
            </span>
          )}
          {podeAnotar && (
            <button
              type="button"
              onClick={onAnotacaoLivre}
              className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-[11px] font-semibold hover:bg-gray-200 dark:hover:bg-gray-600"
              title="Adicionar nota INTERNA pra este empregado (não vai pro WhatsApp)"
            >
              + nota interna
            </button>
          )}
          {podeAnotar && (
            <button
              type="button"
              onClick={onEnviarWhats}
              disabled={pendentesCount === 0 || !temWhatsapp}
              className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                pendentesCount > 0 && temWhatsapp
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed"
              }`}
              title={
                !temWhatsapp
                  ? "Sem WhatsApp cadastrado em Pessoas pra este empregado"
                  : pendentesCount === 0
                  ? "Marque ao menos 1 inconformidade pra enviar"
                  : `Enviar ${pendentesCount} item(ns) num resumo único via WhatsApp`
              }
            >
              💬 Enviar via WhatsApp {pendentesCount > 0 && `(${pendentesCount})`}
            </button>
          )}
        </div>
      </header>

      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {grupo.porData.map(({ date, exc }) => (
          <div key={date} className="px-4 py-3">
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 tabular-nums">
                {fmtDataBr(date)}
              </span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400 capitalize">
                {diaDaSemana(date)}
              </span>
            </div>
            <ol className="space-y-1.5 ml-0">
              {exc.map((e, i) => {
                const meta = RULES_META[e.ruleId];
                const sev = SEVERITY_INFO[e.severity];
                const key = `${grupo.empregadoId}_${e.date}_${e.ruleId}`;
                const ap = apontamentosPorChave.get(key);
                const status = ap?.status;
                const pendente = status === "pendente";
                const enviado = status === "enviado";
                const ciencia = status === "ciencia";
                return (
                  <li
                    key={`${e.ruleId}_${i}`}
                    className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300"
                  >
                    {podeAnotar && !enviado && !ciencia ? (
                      <input
                        type="checkbox"
                        checked={pendente}
                        onChange={() => onToggleEnviar(e)}
                        className="mt-1 accent-indigo-600"
                        title={
                          pendente
                            ? "Marcado pra enviar via WhatsApp — clique pra remover"
                            : "Marcar pra enviar pro empregado via WhatsApp"
                        }
                      />
                    ) : (
                      <span className="w-4 mt-0.5" />
                    )}
                    <span className="text-gray-400 dark:text-gray-500 tabular-nums select-none mt-0.5">
                      {i + 1}.
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap shrink-0 mt-0.5 ${sev.badge}`}
                      title={meta.descricaoRegra}
                    >
                      {meta.icon} {meta.label}
                    </span>
                    <span
                      className={`flex-1 min-w-0 ${
                        pendente ? "font-medium text-gray-900 dark:text-gray-100"
                        : enviado || ciencia ? "opacity-60"
                        : ""
                      }`}
                    >
                      {e.description}
                      {e.detail && (
                        <span className="text-gray-400 dark:text-gray-500"> · {e.detail}</span>
                      )}
                      {/* Indicador inline de status */}
                      {enviado && ap?.enviadoEm && (
                        <span
                          className="ml-2 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-semibold whitespace-nowrap"
                          title={`Avisado via WhatsApp em ${fmtDataHora(ap.enviadoEm)} — no prazo de correção`}
                        >
                          📨 Avisado em {fmtDataHora(ap.enviadoEm)}
                        </span>
                      )}
                      {ciencia && (
                        <span
                          className="ml-2 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 font-semibold whitespace-nowrap"
                          title={`Ciência registrada por ${ap?.cienciaPorNome || "?"} em ${ap?.cienciaEm ? fmtDataHora(ap.cienciaEm) : "?"} — não enviável`}
                        >
                          👁 Ciência · {ap?.cienciaPorNome}
                        </span>
                      )}
                    </span>
                    {/* Ações por linha */}
                    {podeAnotar && !enviado && !ciencia && (
                      <button
                        type="button"
                        onClick={() => onCiencia(e)}
                        className="text-[10px] text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap mt-0.5"
                        title="Tomar ciência (sem enviar pro empregado — caso clássico: intervalo a menos passado, não dá pra ajustar)"
                      >
                        👁 ciência
                      </button>
                    )}
                    {podeAnotar && (enviado || ciencia) && (
                      <button
                        type="button"
                        onClick={() => onReabrir(e)}
                        className="text-[10px] text-gray-500 dark:text-gray-400 hover:underline whitespace-nowrap mt-0.5"
                        title="Reabrir — volta pra pendente, remove o registro de envio/ciência"
                      >
                        ↩ reabrir
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
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
    </section>
  );
}

// ─── Card de Status da Semana ───────────────────────────────────────────────
const STATUS_COR: Record<ExcecaoStatusValor, { bg: string; border: string; emoji: string; cor: string }> = {
  aberto:            { bg: "bg-gray-50 dark:bg-gray-900/40",        border: "border-gray-300 dark:border-gray-700",       emoji: "⚪",  cor: "text-gray-700 dark:text-gray-200" },
  em_tratamento:     { bg: "bg-amber-50 dark:bg-amber-900/20",      border: "border-amber-300 dark:border-amber-800",     emoji: "🟡",  cor: "text-amber-800 dark:text-amber-300" },
  tratado_lider:     { bg: "bg-sky-50 dark:bg-sky-900/20",          border: "border-sky-300 dark:border-sky-800",         emoji: "🔵",  cor: "text-sky-800 dark:text-sky-300" },
  conferido_gerente: { bg: "bg-emerald-50 dark:bg-emerald-900/20",  border: "border-emerald-300 dark:border-emerald-800", emoji: "🟢",  cor: "text-emerald-800 dark:text-emerald-300" },
};

function fmtDataBrCurta(ymd: string): string {
  const [_a, m, d] = ymd.split("-");
  return `${d}/${m}`;
}

function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function StatusSemanaCard({
  statusSemana, carregando, semanaAtiva, temRelatorio, podeMarcar, onMarcar, showHistorico, onToggleHistorico,
}: {
  statusSemana: ExcecaoStatusSemana | null;
  carregando: boolean;
  semanaAtiva: SemanaInfo | undefined;
  temRelatorio: boolean;
  podeMarcar: (s: ExcecaoStatusValor) => boolean;
  onMarcar: (s: ExcecaoStatusValor) => void;
  showHistorico: boolean;
  onToggleHistorico: () => void;
}) {
  if (!semanaAtiva) return null;
  const status: ExcecaoStatusValor = statusSemana?.status || "aberto";
  const c = STATUS_COR[status];
  const label = EXCECAO_STATUS_LABEL[status];

  // Botões disponíveis baseados em status atual + permissão.
  // Cada estado oferece ações de avançar (primary) e voltar (secondary).
  type Acao = { proximo: ExcecaoStatusValor; label: string; variant?: "primary" | "secondary"; disabled?: boolean; tooltip?: string };
  const acoes: Acao[] = [];
  if (status === "aberto") {
    if (podeMarcar("em_tratamento")) acoes.push({
      proximo: "em_tratamento",
      label: "Iniciar tratamento",
      disabled: !temRelatorio,
      tooltip: !temRelatorio ? "Gere o relatório antes de iniciar o tratamento" : undefined,
    });
    if (podeMarcar("tratado_lider")) acoes.push({
      proximo: "tratado_lider",
      label: "✅ Conferido pelo líder",
      disabled: !temRelatorio,
      tooltip: !temRelatorio ? "Gere o relatório antes de marcar como tratado" : undefined,
    });
  } else if (status === "em_tratamento") {
    if (podeMarcar("tratado_lider")) acoes.push({ proximo: "tratado_lider", label: "✅ Conferido pelo líder" });
    if (podeMarcar("aberto"))        acoes.push({ proximo: "aberto",        label: "↩ Reabrir", variant: "secondary" });
  } else if (status === "tratado_lider") {
    if (podeMarcar("conferido_gerente")) acoes.push({ proximo: "conferido_gerente", label: "✓✓ Conferir e fechar" });
    if (podeMarcar("em_tratamento"))     acoes.push({ proximo: "em_tratamento",     label: "↩ Reabrir tratamento", variant: "secondary" });
  } else if (status === "conferido_gerente") {
    if (podeMarcar("tratado_lider"))     acoes.push({ proximo: "tratado_lider",     label: "↩ Reabrir conferência", variant: "secondary" });
  }

  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} p-3 mb-4`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className={`text-sm font-bold ${c.cor}`}>
            {c.emoji} Status: {label}
          </div>
          <div className="text-[11px] text-gray-600 dark:text-gray-400">
            Semana de {fmtDataBrCurta(semanaAtiva.weekStart)} a {fmtDataBrCurta(semanaAtiva.weekEnd)}
            {carregando ? " · carregando…" : ""}
            {statusSemana?.historico && statusSemana.historico.length > 0 && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={onToggleHistorico}
                  className="text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  {showHistorico ? "ocultar histórico" : `${statusSemana.historico.length} evento(s) no histórico`}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {acoes.map((a) => (
            <Button
              key={a.proximo + a.label}
              variant={a.variant === "secondary" ? "secondary" : "primary"}
              size="sm"
              disabled={a.disabled}
              onClick={() => onMarcar(a.proximo)}
              title={a.tooltip}
            >
              {a.label}
            </Button>
          ))}
        </div>
      </div>

      {showHistorico && statusSemana?.historico && statusSemana.historico.length > 0 && (
        <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700">
          <ol className="space-y-1 text-[11px] text-gray-700 dark:text-gray-300">
            {[...statusSemana.historico].reverse().map((h, i) => (
              <li key={i} className="tabular-nums">
                <span className="text-gray-500">{fmtDataHora(h.em)}</span> ·{" "}
                {h.tipo === "atualizacao" ? (
                  <span className="text-indigo-600 dark:text-indigo-400 font-medium">🔄 Relatório atualizado</span>
                ) : (
                  <strong>{EXCECAO_STATUS_LABEL[h.status]}</strong>
                )}{" "}
                · {h.porNome}
                {h.observacao && <span className="italic text-gray-500"> — "{h.observacao}"</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
