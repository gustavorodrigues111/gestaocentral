// ════════════════════════════════════════════════════════════════════════════
//  Relatório de Exceções — compara as marcações de ponto reais (Sólides /
//  Tangerino) com a escala prevista cadastrada no Planejamento e lista as
//  não-conformidades. Casamento de colaborador por CPF.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canVer } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { fmtAnoMes, pad2 } from "../../core/utils/date";
import { derivedScheduleForEmpregado } from "../../core/escala/horarios";
import type { Empregado, EscalaMes, ScheduleStatus } from "../../core/types";
import { fetchPunches, type SolidesDebug } from "../../core/excecoes/solidesClient";
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

// ─── Export CSV ─────────────────────────────────────────────────────────────

function exportCsv(rows: ExceptionRecord[], restNome: string, start: string, end: string) {
  const header = ["Colaborador", "CPF", "Data", "Tipo", "Severidade", "Descrição", "Detalhe"];
  const esc = (v: string) => `"${(v || "").replace(/"/g, '""')}"`;
  const lines = [header.map(esc).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.employeeName,
        r.cpf,
        r.date,
        RULES_META[r.ruleId].label,
        SEVERITY_INFO[r.severity].label,
        r.description,
        r.detail || "",
      ]
        .map((v) => esc(String(v)))
        .join(","),
    );
  }
  // BOM (﻿) pro Excel abrir como UTF-8
  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `excecoes_${restNome.replace(/\s+/g, "-")}_${start}_a_${end}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ════════════════════════════════════════════════════════════════════════════

export function ExcecoesPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find((r) => r.id === rid) || null;
  const podeVer = canVer(me, rid, "excecoes");

  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [startDate, setStartDate] = useState(firstDayOfCurrentMonth());
  const [endDate, setEndDate] = useState(todayYmd());

  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const [result, setResult] = useState<GenerateReportResult | null>(null);
  const [debug, setDebug] = useState<SolidesDebug | null>(null);
  const [geradoEm, setGeradoEm] = useState<{ start: string; end: string } | null>(null);

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
      const { punches, debug: dbg } = await fetchPunches(startDate, endDate, activeRestaurant?.shortCode);
      const escalaPorEmpregado = await buildEscalaContext(empregados, rid, startDate, endDate);
      const report = generateExceptionsReport({
        punches,
        empregados,
        escalaPorEmpregado,
        startDate,
        endDate,
      });
      setResult(report);
      setDebug(dbg || null);
      setGeradoEm({ start: startDate, end: endDate });
      // Reseta filtros
      setFiltroColaborador("");
      setFiltroRegra("");
      setFiltroSeveridade("");
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
      if (filtroColaborador && e.employeeName !== filtroColaborador) return false;
      if (filtroRegra && e.ruleId !== filtroRegra) return false;
      if (filtroSeveridade && e.severity !== filtroSeveridade) return false;
      return true;
    });
  }, [result, filtroColaborador, filtroRegra, filtroSeveridade]);

  // Contagem por severidade (do total, não do filtrado)
  const resumo = useMemo(() => {
    const base = { grave: 0, aviso: 0, info: 0 };
    if (!result) return base;
    for (const e of result.exceptions) base[e.severity] += 1;
    return base;
  }, [result]);

  if (!activeRestaurant) {
    return <div className="text-gray-500">Selecione um restaurante.</div>;
  }
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
        ⚠️ Relatório de Exceções
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {activeRestaurant.nome} · marcações de ponto (Sólides) vs escala prevista
      </p>

      {/* ── Período + ação ── */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4">
        <div className="flex items-end gap-3 flex-wrap">
          <Input
            label="Data inicial"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <Input
            label="Data final"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
          <Button onClick={gerar} disabled={loading || empregados.length === 0}>
            {loading ? "Gerando..." : "🔍 Gerar relatório"}
          </Button>
          {result && (
            <Button
              variant="secondary"
              onClick={() =>
                exportCsv(
                  excecoesFiltradas,
                  activeRestaurant.nome,
                  geradoEm?.start || startDate,
                  geradoEm?.end || endDate,
                )
              }
              disabled={excecoesFiltradas.length === 0}
            >
              ⬇️ Exportar CSV
            </Button>
          )}
        </div>
        {empregados.length === 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
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
              {agruparPorColabDate(excecoesFiltradas).map((grupo) => (
                <ColaboradorBlock key={grupo.key} grupo={grupo} />
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
  nome: string;
  cpf: string;
  totalExc: number;
  totalGraves: number;
  porData: { date: string; exc: ExceptionRecord[] }[];
};

function agruparPorColabDate(rows: ExceptionRecord[]): GrupoColab[] {
  type Acc = { nome: string; cpf: string; porData: Map<string, ExceptionRecord[]> };
  const map = new Map<string, Acc>();
  for (const e of rows) {
    const k = `${e.employeeId}_${e.cpf}`;
    let g = map.get(k);
    if (!g) {
      g = { nome: e.employeeName, cpf: e.cpf, porData: new Map() };
      map.set(k, g);
    }
    let arr = g.porData.get(e.date);
    if (!arr) {
      arr = [];
      g.porData.set(e.date, arr);
    }
    arr.push(e);
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
      return { key, nome: g.nome, cpf: g.cpf, totalExc: total, totalGraves: graves, porData };
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

function ColaboradorBlock({ grupo }: { grupo: GrupoColab }) {
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
        <div className="flex items-center gap-2 text-[11px]">
          <span className="px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold">
            {grupo.totalExc} exc.
          </span>
          {grupo.totalGraves > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 font-semibold">
              {grupo.totalGraves} grave(s)
            </span>
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
                return (
                  <li
                    key={`${e.ruleId}_${i}`}
                    className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300"
                  >
                    <span className="text-gray-400 dark:text-gray-500 tabular-nums select-none mt-0.5">
                      {i + 1}.
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap shrink-0 mt-0.5 ${sev.badge}`}
                      title={meta.descricaoRegra}
                    >
                      {meta.icon} {meta.label}
                    </span>
                    <span className="flex-1 min-w-0">
                      {e.description}
                      {e.detail && (
                        <span className="text-gray-400 dark:text-gray-500"> · {e.detail}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
