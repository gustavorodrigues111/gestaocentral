// ════════════════════════════════════════════════════════════════════════════
//  Aba "Por Empregado" — visão alternativa da aba "Por Semana", agrupada por
//  EMPREGADO. Usa exatamente os mesmos dados (relatorioCache + apontamentos +
//  notasInternas das semanas) — NÃO duplica lógica nem dispara nova chamada
//  à Sólides.
//
//  Pra cada empregado, mostra 4 semanas (navegáveis) com as inconformidades
//  agrupadas por semana. Cada item tem as mesmas ações da view por semana
//  (checkbox enviar, ciência, reabrir, +nota). O botão "Enviar pendentes"
//  é cross-semana — junta tudo num WhatsApp único.
//
//  Status da semana (Conferido pelo líder/gerente) SÓ é alterado pela aba
//  "Por Semana" — aqui é só badge informativo.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { canVer } from "../../core/auth/permissions";
import {
  adicionarApontamento,
  adicionarNotaInterna,
  listarStatusDoRestaurante,
  marcarApontamentoCiencia,
  marcarApontamentosEnviados,
  removerApontamento,
  removerNotaInterna,
} from "../../core/excecoes/statusSemana";
import { janelaSemanas, type SemanaInfo } from "../../core/excecoes/semanas";
import {
  montarMensagemAjustesCrossSemana,
  whatsLink,
  type GrupoSemana,
} from "../../core/excecoes/whatsapp";
import {
  AREAS,
  EXCECAO_STATUS_LABEL,
  type ApontamentoFuncionario,
  type Area,
  type Cargo,
  type Empregado,
  type ExcecaoStatusSemana,
  type ExcecaoStatusValor,
  type NotaInterna,
  type Pessoa,
} from "../../core/types";
import { RULES_META } from "../../core/excecoes/rules";
import type { ExceptionRecord, ExceptionRuleId, ExceptionSeverity } from "../../core/excecoes/types";

type Props = {
  rid: string;
  restNome: string;
};

const SEVERITY_INFO: Record<ExceptionSeverity, { badge: string }> = {
  grave: { badge: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
  aviso: { badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  info:  { badge: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" },
};

// Cor do badge do status da semana (não interativo, só informativo aqui)
const STATUS_BADGE: Record<ExcecaoStatusValor, string> = {
  aberto:            "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300",
  em_tratamento:     "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300",
  tratado_lider:     "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300",
  conferido_gerente: "bg-sky-100 dark:bg-sky-900/30 text-sky-800 dark:text-sky-300",
};

function fmtDataBr(ymd: string): string {
  const [a, m, d] = ymd.split("-");
  if (!a || !m || !d) return ymd;
  return `${d}/${m}/${a}`;
}
function fmtDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}
function diaDaSemana(ymd: string): string {
  const [a, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  if (!a || !m || !d) return "";
  return new Date(a, m - 1, d).toLocaleDateString("pt-BR", { weekday: "long" });
}
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ────────────────────────────────────────────────────────────────────────────

export function PorEmpregadoTab({ rid, restNome }: Props) {
  const { pessoa: me } = useAuth();
  const podeVer = canVer(me, rid, "excecoes");

  // Janela de 4 semanas — default termina na semana atual. Nav anda em
  // blocos de 4. `janelaFim` é a data de referência (qualquer dia da última
  // semana da janela).
  const [janelaFim, setJanelaFim] = useState<string>(todayYmd());
  const semanas = useMemo<SemanaInfo[]>(() => janelaSemanas(janelaFim, 4), [janelaFim]);
  const weekStarts = useMemo(() => new Set(semanas.map((s) => s.weekStart)), [semanas]);

  function navegar(deltaSemanas: number) {
    const [y, m, d] = janelaFim.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + deltaSemanas * 7);
    setJanelaFim(
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`,
    );
  }

  // Carrega tudo: empregados, pessoas (pra whatsapp), cargos (pra área),
  // statusSemana (pras 4 semanas relevantes — filtrado client-side).
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [semanasDocs, setSemanasDocs] = useState<ExcecaoStatusSemana[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(
      query(collection(db, "empregados"), where("restaurantId", "==", rid)),
      (s) => setEmpregados(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Empregado)),
    );
    const u2 = onSnapshot(
      query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid)),
      (s) => setPessoas(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Pessoa)),
    );
    const u3 = onSnapshot(
      query(collection(db, "cargos"), where("restaurantId", "==", rid)),
      (s) => setCargos(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Cargo)),
    );
    return () => { u1(); u2(); u3(); };
  }, [rid]);

  async function recarregarSemanas() {
    if (!rid) return;
    setCarregando(true);
    setErro("");
    try {
      const rows = await listarStatusDoRestaurante(rid);
      setSemanasDocs(rows);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar.");
    } finally {
      setCarregando(false);
    }
  }
  useEffect(() => { void recarregarSemanas(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [rid]);

  // Filtro de áreas (mesmo padrão da Por Semana)
  const [filtroAreas, setFiltroAreas] = useState<Set<Area>>(new Set());
  function toggleArea(a: Area) {
    setFiltroAreas((cur) => {
      const next = new Set(cur);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });
  }

  // Maps auxiliares
  const cargoPorId = useMemo(() => {
    const m = new Map<string, Cargo>();
    for (const c of cargos) m.set(c.id, c);
    return m;
  }, [cargos]);
  const pessoaPorId = useMemo(() => {
    const m = new Map<string, Pessoa>();
    for (const p of pessoas) m.set(p.id, p);
    return m;
  }, [pessoas]);
  const areaByEmpId = useMemo(() => {
    const m = new Map<string, Area>();
    for (const e of empregados) {
      const a = cargoPorId.get(e.cargoId)?.area;
      if (a) m.set(e.id, a);
    }
    return m;
  }, [empregados, cargoPorId]);
  const whatsByEmpId = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of empregados) {
      const w = e.pessoaId ? pessoaPorId.get(e.pessoaId)?.whatsapp : undefined;
      if (w) m.set(e.id, w);
    }
    return m;
  }, [empregados, pessoaPorId]);
  const areasDisponiveis = useMemo(() => {
    const set = new Set<Area>();
    for (const a of areaByEmpId.values()) set.add(a);
    return AREAS.filter((a) => set.has(a));
  }, [areaByEmpId]);

  // Semanas relevantes (só as 4 da janela), indexadas por weekStart
  const semanasPorWeekStart = useMemo(() => {
    const m = new Map<string, ExcecaoStatusSemana>();
    for (const s of semanasDocs) {
      if (weekStarts.has(s.weekStart)) m.set(s.weekStart, s);
    }
    return m;
  }, [semanasDocs, weekStarts]);

  // Pra cada empregado: monta o agrupamento por semana
  type ExcecaoPorSemana = {
    semana: SemanaInfo;
    statusSemana: ExcecaoStatusValor;
    exceptions: ExceptionRecord[];
    apontamentosPorChave: Map<string, ApontamentoFuncionario>;
    notas: NotaInterna[];
  };
  type EmpregadoAgregado = {
    empregado: Empregado;
    area?: Area;
    semanas: ExcecaoPorSemana[];
    totalInconf: number;
    pendentes: number;
    enviados: number;
    ciencias: number;
  };

  const agregados = useMemo<EmpregadoAgregado[]>(() => {
    const empPorCpf = new Map<string, Empregado>();
    for (const e of empregados) {
      const cpf = (e.cpf || "").replace(/\D/g, "");
      if (cpf) empPorCpf.set(cpf, e);
    }

    return empregados
      .filter((e) => {
        if (filtroAreas.size === 0) return true;
        const area = areaByEmpId.get(e.id);
        return area != null && filtroAreas.has(area);
      })
      .map<EmpregadoAgregado>((emp) => {
        const cpfD = (emp.cpf || "").replace(/\D/g, "");
        const empSemanas: ExcecaoPorSemana[] = semanas.map((sw) => {
          const doc = semanasPorWeekStart.get(sw.weekStart);
          const cache = doc?.relatorioCache;
          // Filtra exceções desse empregado pelo CPF
          const exceptions = ((cache?.exceptions as ExceptionRecord[] | undefined) || []).filter(
            (e) => (e.cpf || "").replace(/\D/g, "") === cpfD,
          );
          // Apontamentos do empregado nessa semana
          const apMap = new Map<string, ApontamentoFuncionario>();
          for (const a of doc?.apontamentos || []) {
            if (a.empregadoId === emp.id && a.origem === "inconformidade" && a.ruleId && a.data) {
              apMap.set(`${a.empregadoId}_${a.data}_${a.ruleId}`, a);
            }
          }
          // Notas internas do empregado nessa semana
          const notas = (doc?.notasInternas || []).filter((n) => n.empregadoId === emp.id);
          return {
            semana: sw,
            statusSemana: doc?.status || "aberto",
            exceptions,
            apontamentosPorChave: apMap,
            notas,
          };
        });

        let totalInconf = 0, pendentes = 0, enviados = 0, ciencias = 0;
        for (const s of empSemanas) {
          totalInconf += s.exceptions.length;
          for (const ap of s.apontamentosPorChave.values()) {
            if (ap.status === "pendente") pendentes += 1;
            else if (ap.status === "enviado") enviados += 1;
            else if (ap.status === "ciencia") ciencias += 1;
          }
        }
        return { empregado: emp, area: areaByEmpId.get(emp.id), semanas: empSemanas, totalInconf, pendentes, enviados, ciencias };
      })
      .sort((a, b) => a.empregado.nome.localeCompare(b.empregado.nome));
  }, [empregados, semanas, semanasPorWeekStart, filtroAreas, areaByEmpId]);

  // Filtra: separa empregados COM inconf dos sem (ambos aparecem, mas
  // os "sem" ficam mais compactos)
  const comInconf = agregados.filter((a) => a.totalInconf > 0);
  const semInconf = agregados.filter((a) => a.totalInconf === 0);

  // ─── Ações sobre apontamentos (mesmas da Por Semana) ──────────────────────
  // Cada ação precisa saber A QUE SEMANA o apontamento pertence — daí
  // recebe a SemanaInfo + o ExceptionRecord da semana correspondente.
  const semanaConferida = (st: ExcecaoStatusValor) => st === "conferido_gerente";

  function gerarTextoApontamento(exc: ExceptionRecord): string {
    const meta = RULES_META[exc.ruleId];
    return `${meta.label} em ${fmtDataBr(exc.date)}: ${exc.description}${
      exc.detail ? ` (${exc.detail})` : ""
    }`;
  }

  async function toggleEnviar(emp: Empregado, sw: SemanaInfo, exc: ExceptionRecord, sec: ExcecaoPorSemana) {
    if (!me) return;
    if (semanaConferida(sec.statusSemana)) {
      alert("Semana já conferida — não dá pra mexer nessa.");
      return;
    }
    const key = `${emp.id}_${exc.date}_${exc.ruleId}`;
    const existente = sec.apontamentosPorChave.get(key);
    try {
      if (existente && existente.status === "pendente") {
        await removerApontamento(rid, sw.weekStart, sw.weekEnd, existente.id);
      } else if (existente) {
        alert(
          existente.status === "enviado"
            ? `Já enviado em ${existente.enviadoEm ? fmtDataHora(existente.enviadoEm) : "?"}. Use "↩ reabrir".`
            : `Já marcado como ciência por ${existente.cienciaPorNome}. Use "↩ reabrir".`,
        );
        return;
      } else {
        await adicionarApontamento(
          rid, sw.weekStart, sw.weekEnd,
          {
            empregadoId: emp.id,
            empregadoNome: emp.nome,
            cpf: emp.cpf || undefined,
            texto: gerarTextoApontamento(exc),
            data: exc.date,
            origem: "inconformidade",
            ruleId: exc.ruleId,
          },
          me,
          "pendente",
        );
      }
      await recarregarSemanas();
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  }

  async function darCiencia(emp: Empregado, sw: SemanaInfo, exc: ExceptionRecord, sec: ExcecaoPorSemana) {
    if (!me) return;
    if (semanaConferida(sec.statusSemana)) {
      alert("Semana já conferida.");
      return;
    }
    const key = `${emp.id}_${exc.date}_${exc.ruleId}`;
    const existente = sec.apontamentosPorChave.get(key);
    try {
      let apId: string;
      if (existente) {
        await marcarApontamentoCiencia(rid, sw.weekStart, sw.weekEnd, existente.id, me);
        apId = existente.id;
      } else {
        const upd = await adicionarApontamento(
          rid, sw.weekStart, sw.weekEnd,
          {
            empregadoId: emp.id,
            empregadoNome: emp.nome,
            cpf: emp.cpf || undefined,
            texto: gerarTextoApontamento(exc),
            data: exc.date,
            origem: "inconformidade",
            ruleId: exc.ruleId,
          },
          me,
          "ciencia",
        );
        apId = (upd.apontamentos || []).slice(-1)[0]?.id || "";
      }
      await adicionarNotaInterna(
        rid, sw.weekStart, sw.weekEnd,
        {
          empregadoId: emp.id,
          empregadoNome: emp.nome,
          texto: `👁 Ciência tomada (não-tratável retroativo): ${gerarTextoApontamento(exc)}`,
          origem: "ciencia",
          apontamentoIds: [apId],
        },
        me,
      );
      await recarregarSemanas();
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  }

  async function reabrir(emp: Empregado, sw: SemanaInfo, exc: ExceptionRecord, sec: ExcecaoPorSemana) {
    if (!me) return;
    if (semanaConferida(sec.statusSemana)) return;
    const key = `${emp.id}_${exc.date}_${exc.ruleId}`;
    const existente = sec.apontamentosPorChave.get(key);
    if (!existente) return;
    if (!confirm("Reabrir esse apontamento? Volta pra pendente.")) return;
    try {
      await removerApontamento(rid, sw.weekStart, sw.weekEnd, existente.id);
      await recarregarSemanas();
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  }

  async function criarNota(emp: Empregado, sw: SemanaInfo, sec: ExcecaoPorSemana) {
    if (!me) return;
    if (semanaConferida(sec.statusSemana)) {
      alert("Semana já conferida.");
      return;
    }
    const txt = prompt(
      `Nota INTERNA sobre ${emp.nome} (semana de ${fmtDataBr(sw.weekStart)} a ${fmtDataBr(sw.weekEnd)}). Não vai pro WhatsApp:`,
      "",
    );
    if (!txt || !txt.trim()) return;
    try {
      await adicionarNotaInterna(
        rid, sw.weekStart, sw.weekEnd,
        { empregadoId: emp.id, empregadoNome: emp.nome, texto: txt.trim(), origem: "manual" },
        me,
      );
      await recarregarSemanas();
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  }

  async function apagarNota(sw: SemanaInfo, notaId: string) {
    if (!confirm("Apagar essa nota?")) return;
    try {
      await removerNotaInterna(rid, sw.weekStart, sw.weekEnd, notaId);
      await recarregarSemanas();
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  }

  // Envia pendentes do empregado em TODAS as semanas da janela num WhatsApp
  // só. Após disparar, marca cada semana relevante e cria 1 nota interna
  // por semana registrando o envio.
  async function enviarWhatsCross(agg: EmpregadoAgregado) {
    if (!me) return;
    const grupos: GrupoSemana[] = [];
    const idsPorSemana: { weekStart: string; weekEnd: string; ids: string[] }[] = [];
    for (const sec of agg.semanas) {
      const pendentes: ApontamentoFuncionario[] = [];
      for (const ap of sec.apontamentosPorChave.values()) {
        if (ap.status === "pendente") pendentes.push(ap);
      }
      if (pendentes.length > 0) {
        grupos.push({ weekStart: sec.semana.weekStart, weekEnd: sec.semana.weekEnd, apontamentos: pendentes });
        idsPorSemana.push({ weekStart: sec.semana.weekStart, weekEnd: sec.semana.weekEnd, ids: pendentes.map((p) => p.id) });
      }
    }
    if (grupos.length === 0) {
      alert("Nenhum item pendente pra enviar (marque com checkbox primeiro).");
      return;
    }
    const whatsapp = whatsByEmpId.get(agg.empregado.id);
    if (!whatsapp) {
      alert(`${agg.empregado.nome} não tem WhatsApp cadastrado em Pessoas.`);
      return;
    }
    const msg = montarMensagemAjustesCrossSemana({
      empregadoNome: agg.empregado.nome,
      restNome,
      grupos,
    });
    const link = whatsLink(whatsapp, msg);
    if (!link) {
      alert(`WhatsApp de ${agg.empregado.nome} inválido (precisa ter DDD + número).`);
      return;
    }
    window.open(link, "_blank");
    // Marca enviado + cria nota auto em cada semana
    try {
      const totalItens = grupos.reduce((s, g) => s + g.apontamentos.length, 0);
      for (const grp of idsPorSemana) {
        await marcarApontamentosEnviados(rid, grp.weekStart, grp.weekEnd, grp.ids);
        const itens = grupos.find((g) => g.weekStart === grp.weekStart)?.apontamentos || [];
        const resumoItens = itens.map((a, i) => `${i + 1}. ${a.texto}`).join("\n");
        await adicionarNotaInterna(
          rid, grp.weekStart, grp.weekEnd,
          {
            empregadoId: agg.empregado.id,
            empregadoNome: agg.empregado.nome,
            texto: `📨 Empregado avisado via WhatsApp em ${fmtDataHora(new Date().toISOString())} (envio agregado das ${grupos.length} semana(s), ${totalItens} item(ns) no total). Itens desta semana:\n${resumoItens}`,
            origem: "envio_whatsapp",
            apontamentoIds: grp.ids,
          },
          me,
        );
      }
      await recarregarSemanas();
    } catch (e) {
      console.error("Erro pós-envio cross-semana:", e);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  const labelJanela = semanas.length > 0
    ? `${fmtDataBr(semanas[0].weekStart)} a ${fmtDataBr(semanas[semanas.length - 1].weekEnd)}`
    : "—";

  return (
    <div className="space-y-4">
      {/* Header: navegação da janela + filtro de áreas */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => navegar(-4)}
            className="text-lg leading-none px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
            aria-label="4 semanas anteriores"
          >←</button>
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            4 semanas: {labelJanela}
          </div>
          <button
            type="button"
            onClick={() => navegar(4)}
            className="text-lg leading-none px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
            aria-label="4 semanas seguintes"
          >→</button>
          <button
            type="button"
            onClick={() => setJanelaFim(todayYmd())}
            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline ml-1"
          >hoje</button>
          <button
            type="button"
            onClick={() => void recarregarSemanas()}
            disabled={carregando}
            className="ml-auto text-[11px] uppercase tracking-wider font-semibold px-3 py-1 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title="Recarrega os dados das semanas (não chama Sólides — só relê o cache)"
          >
            {carregando ? "⏳ atualizando…" : "🔄 Atualizar"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFiltroAreas(new Set())}
            className={`text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full transition-colors ${
              filtroAreas.size === 0
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
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
              >
                {a}
              </button>
            );
          })}
        </div>
      </div>

      {erro && (
        <div className="rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3 text-sm text-rose-800 dark:text-rose-300">
          ❌ {erro}
        </div>
      )}

      {/* Empregados com inconformidades */}
      <div className="space-y-3">
        {comInconf.map((agg) => (
          <EmpregadoCard
            key={agg.empregado.id}
            agg={agg}
            temWhatsapp={!!whatsByEmpId.get(agg.empregado.id)}
            onToggleEnviar={(sw, exc, sec) => toggleEnviar(agg.empregado, sw, exc, sec)}
            onCiencia={(sw, exc, sec) => darCiencia(agg.empregado, sw, exc, sec)}
            onReabrir={(sw, exc, sec) => reabrir(agg.empregado, sw, exc, sec)}
            onNovaNota={(sw, sec) => criarNota(agg.empregado, sw, sec)}
            onApagarNota={(sw, notaId) => apagarNota(sw, notaId)}
            onEnviarWhats={() => enviarWhatsCross(agg)}
          />
        ))}
      </div>

      {/* Empregados sem inconformidades — linha compacta */}
      {semInconf.length > 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
            ✅ Sem inconformidades nesta janela ({semInconf.length})
          </div>
          <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
            {semInconf.map((agg) => (
              <li key={agg.empregado.id} className="flex items-center gap-2">
                <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                <span>{agg.empregado.nome}</span>
                {agg.area && <span className="text-gray-400">· {agg.area}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {comInconf.length === 0 && semInconf.length === 0 && !carregando && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          Nenhum empregado nessa filtragem.
        </div>
      )}
    </div>
  );
}

// ─── EmpregadoCard ─────────────────────────────────────────────────────────

function EmpregadoCard({
  agg,
  temWhatsapp,
  onToggleEnviar,
  onCiencia,
  onReabrir,
  onNovaNota,
  onApagarNota,
  onEnviarWhats,
}: {
  agg: {
    empregado: Empregado;
    area?: Area;
    semanas: {
      semana: SemanaInfo;
      statusSemana: ExcecaoStatusValor;
      exceptions: ExceptionRecord[];
      apontamentosPorChave: Map<string, ApontamentoFuncionario>;
      notas: NotaInterna[];
    }[];
    totalInconf: number;
    pendentes: number;
    enviados: number;
    ciencias: number;
  };
  temWhatsapp: boolean;
  onToggleEnviar: (sw: SemanaInfo, exc: ExceptionRecord, sec: typeof agg.semanas[number]) => void;
  onCiencia: (sw: SemanaInfo, exc: ExceptionRecord, sec: typeof agg.semanas[number]) => void;
  onReabrir: (sw: SemanaInfo, exc: ExceptionRecord, sec: typeof agg.semanas[number]) => void;
  onNovaNota: (sw: SemanaInfo, sec: typeof agg.semanas[number]) => void;
  onApagarNota: (sw: SemanaInfo, notaId: string) => void;
  onEnviarWhats: () => void;
}) {
  const [expandido, setExpandido] = useState(false);
  const podeAcoes = !agg.semanas.every((s) => s.statusSemana === "conferido_gerente");
  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <header
        className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between flex-wrap gap-2 cursor-pointer"
        onClick={() => setExpandido((v) => !v)}
      >
        <div className="min-w-0 flex items-center gap-2">
          <span className="text-gray-400">{expandido ? "▼" : "▶"}</span>
          <div>
            <div className="font-bold text-gray-900 dark:text-gray-100">{agg.empregado.nome}</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              {agg.area || "—"} · {agg.totalInconf} inconformidade(s) na janela
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] flex-wrap" onClick={(e) => e.stopPropagation()}>
          {agg.pendentes > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 font-semibold">
              ⏳ {agg.pendentes} pend
            </span>
          )}
          {agg.enviados > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-semibold">
              📨 {agg.enviados} enviado(s)
            </span>
          )}
          {agg.ciencias > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 font-semibold">
              👁 {agg.ciencias} ciência(s)
            </span>
          )}
          <Button
            size="sm"
            variant={agg.pendentes > 0 && temWhatsapp ? "primary" : "secondary"}
            disabled={agg.pendentes === 0 || !temWhatsapp || !podeAcoes}
            onClick={onEnviarWhats}
            title={
              !temWhatsapp ? "Sem WhatsApp cadastrado em Pessoas"
              : agg.pendentes === 0 ? "Marque ao menos 1 inconformidade pra enviar"
              : `Enviar ${agg.pendentes} pendente(s) em ${agg.semanas.filter((s) => Array.from(s.apontamentosPorChave.values()).some((a) => a.status === "pendente")).length} semana(s) num só WhatsApp`
            }
          >
            💬 Enviar pendentes {agg.pendentes > 0 && `(${agg.pendentes})`}
          </Button>
        </div>
      </header>

      {expandido && (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {agg.semanas.map((sec) => (
            <SemanaSecao
              key={sec.semana.weekStart}
              empregadoId={agg.empregado.id}
              sec={sec}
              podeAcoes={sec.statusSemana !== "conferido_gerente"}
              onToggleEnviar={(exc) => onToggleEnviar(sec.semana, exc, sec)}
              onCiencia={(exc) => onCiencia(sec.semana, exc, sec)}
              onReabrir={(exc) => onReabrir(sec.semana, exc, sec)}
              onNovaNota={() => onNovaNota(sec.semana, sec)}
              onApagarNota={(notaId) => onApagarNota(sec.semana, notaId)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SemanaSecao({
  empregadoId,
  sec,
  podeAcoes,
  onToggleEnviar,
  onCiencia,
  onReabrir,
  onNovaNota,
  onApagarNota,
}: {
  empregadoId: string;
  sec: {
    semana: SemanaInfo;
    statusSemana: ExcecaoStatusValor;
    exceptions: ExceptionRecord[];
    apontamentosPorChave: Map<string, ApontamentoFuncionario>;
    notas: NotaInterna[];
  };
  podeAcoes: boolean;
  onToggleEnviar: (exc: ExceptionRecord) => void;
  onCiencia: (exc: ExceptionRecord) => void;
  onReabrir: (exc: ExceptionRecord) => void;
  onNovaNota: () => void;
  onApagarNota: (notaId: string) => void;
}) {
  const semInconf = sec.exceptions.length === 0;
  if (semInconf && sec.notas.length === 0) return null; // semana vazia: esconde

  // Agrupa exceções por data
  const porData = useMemo(() => {
    const m = new Map<string, ExceptionRecord[]>();
    for (const e of sec.exceptions) {
      const arr = m.get(e.date) || [];
      arr.push(e);
      m.set(e.date, arr);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [sec.exceptions]);

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-gray-800 dark:text-gray-100">
            Sem {sec.semana.label}
          </span>
          <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[sec.statusSemana]}`}>
            {EXCECAO_STATUS_LABEL[sec.statusSemana]}
          </span>
        </div>
        {podeAcoes && (
          <button
            type="button"
            onClick={onNovaNota}
            className="text-[10px] text-gray-600 dark:text-gray-400 hover:underline"
          >
            + nota interna
          </button>
        )}
      </div>

      {semInconf ? (
        <div className="text-[11px] text-gray-400 italic">Sem inconformidades nesta semana</div>
      ) : (
        porData.map(([date, excs]) => (
          <div key={date}>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1 tabular-nums">
              {fmtDataBr(date)} <span className="capitalize">· {diaDaSemana(date)}</span>
            </div>
            <ol className="space-y-1 ml-1">
              {excs.map((exc, i) => {
                const meta = RULES_META[exc.ruleId as ExceptionRuleId];
                const sev = SEVERITY_INFO[exc.severity];
                const key = `${empregadoId}_${exc.date}_${exc.ruleId}`;
                const ap = sec.apontamentosPorChave.get(key);
                const pendente = ap?.status === "pendente";
                const enviado = ap?.status === "enviado";
                const ciencia = ap?.status === "ciencia";
                return (
                  <li key={`${exc.ruleId}_${i}`} className="flex items-start gap-2 text-sm">
                    {podeAcoes && !enviado && !ciencia ? (
                      <input
                        type="checkbox"
                        checked={pendente}
                        onChange={() => onToggleEnviar(exc)}
                        className="mt-1 accent-indigo-600"
                      />
                    ) : (
                      <span className="w-4 mt-0.5" />
                    )}
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap shrink-0 mt-0.5 ${sev.badge}`}>
                      {meta.icon} {meta.label}
                    </span>
                    <span className={`flex-1 min-w-0 ${pendente ? "font-medium text-gray-900 dark:text-gray-100" : enviado || ciencia ? "opacity-60" : ""}`}>
                      {exc.description}
                      {exc.detail && <span className="text-gray-400 dark:text-gray-500"> · {exc.detail}</span>}
                      {enviado && ap?.enviadoEm && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-semibold whitespace-nowrap">
                          📨 {fmtDataHora(ap.enviadoEm)}
                        </span>
                      )}
                      {ciencia && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 font-semibold whitespace-nowrap">
                          👁 {ap?.cienciaPorNome}
                        </span>
                      )}
                    </span>
                    {podeAcoes && !enviado && !ciencia && (
                      <button
                        type="button"
                        onClick={() => onCiencia(exc)}
                        className="text-[10px] text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap mt-0.5"
                      >
                        👁 ciência
                      </button>
                    )}
                    {podeAcoes && (enviado || ciencia) && (
                      <button
                        type="button"
                        onClick={() => onReabrir(exc)}
                        className="text-[10px] text-gray-500 dark:text-gray-400 hover:underline whitespace-nowrap mt-0.5"
                      >
                        ↩ reabrir
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        ))
      )}

      {sec.notas.length > 0 && (
        <div className="mt-2 pt-2 border-t border-amber-100 dark:border-amber-900/30 bg-amber-50/40 dark:bg-amber-900/10 -mx-4 px-4 py-2">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-400 mb-1">
            📋 Log do tratamento
          </div>
          <ul className="space-y-1">
            {[...sec.notas]
              .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
              .map((n) => (
                <li key={n.id} className="flex items-start gap-2 text-[11px] text-gray-700 dark:text-gray-300">
                  <span className="text-gray-400 dark:text-gray-500 mt-0.5 shrink-0">
                    {n.origem === "envio_whatsapp" ? "📨" : n.origem === "ciencia" ? "👁" : "✍"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="whitespace-pre-wrap">{n.texto}</div>
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                      {n.criadoPorNome} · {fmtDataHora(n.criadoEm)}
                    </div>
                  </div>
                  {podeAcoes && n.origem === "manual" && (
                    <button
                      type="button"
                      onClick={() => onApagarNota(n.id)}
                      className="text-[10px] text-rose-600 dark:text-rose-400 hover:underline whitespace-nowrap"
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
