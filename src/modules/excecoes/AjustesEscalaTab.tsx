// ════════════════════════════════════════════════════════════════════════════
//  Aba "Apontamentos de Escala" — relatório DERIVADO do tratamento, gerado
//  quando o gerente confere a semana. Lista o que precisa ajuste MANUAL na
//  ESCALA PRATICADA do Planejamento (não no ponto Sólides):
//    • falta sem ajuste → lançar falta na praticada
//    • marcação fora da escala → trabalho em dia previsto pra folga
//
//  O líder ajusta cada item manualmente na praticada e clica em "✓ Ajustado"
//  pra mover pro histórico. Só aparece semana com status conferido_gerente
//  — se o gerente reabrir, some daqui e a semana volta pra Inconformidades.
//
//  Futuro: conectar atualização automática da praticada quando marca.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import {
  listarStatusDoRestaurante,
  marcarApontamentoEscalaAjustado,
  reabrirApontamentoEscala,
} from "../../core/excecoes/statusSemana";
import type { ApontamentoEscala, Area, Cargo, Empregado, ExcecaoStatusSemana } from "../../core/types";
import { AREAS } from "../../core/types";

type Props = { rid: string };

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

// Labels amigáveis pros ruleIds que afetam escala.
const REGRA_LABEL: Record<string, { label: string; icon: string }> = {
  faltaSemAjuste:       { label: "Falta sem ajuste",       icon: "❓" },
  marcacaoForaDaEscala: { label: "Marcação fora da escala", icon: "📍" },
};

export function AjustesEscalaTab({ rid }: Props) {
  const { pessoa: me } = useAuth();
  const [semanas, setSemanas] = useState<ExcecaoStatusSemana[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [filtroArea, setFiltroArea] = useState<Area | "">("");

  // Carrega empregados + cargos pra resolver área via CPF do apontamento.
  // O ApontamentoEscala guarda CPF no campo empregadoId (decisão histórica
  // do helper de geração) — daí o cruzamento é por CPF.
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(
      query(collection(db, "empregados"), where("restaurantId", "==", rid)),
      (snap) => setEmpregados(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Empregado)),
    );
    const u2 = onSnapshot(
      query(collection(db, "cargos"), where("restaurantId", "==", rid)),
      (snap) => setCargos(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Cargo)),
    );
    return () => { u1(); u2(); };
  }, [rid]);

  // Mapa CPF (só dígitos) → Area
  const areaByCpf = useMemo(() => {
    const cargoPorId = new Map<string, Cargo>();
    for (const c of cargos) cargoPorId.set(c.id, c);
    const m = new Map<string, Area>();
    for (const emp of empregados) {
      const cpfD = (emp.cpf || "").replace(/\D/g, "");
      const area = cargoPorId.get(emp.cargoId)?.area;
      if (cpfD && area) m.set(cpfD, area);
    }
    return m;
  }, [empregados, cargos]);

  const areasDisponiveis = useMemo(() => {
    const set = new Set<Area>();
    for (const a of areaByCpf.values()) set.add(a);
    return AREAS.filter((a) => set.has(a));
  }, [areaByCpf]);

  async function recarregar() {
    if (!rid) return;
    setLoading(true);
    setErro("");
    try {
      const rows = await listarStatusDoRestaurante(rid);
      setSemanas(rows);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void recarregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [rid]);

  // Só semanas conferidas pelo gerente entram aqui — semanas em tratamento
  // ou tratado_lider ainda não estão prontas pra ajuste manual da praticada.
  const semanasConferidas = useMemo(
    () =>
      semanas
        .filter((s) => s.status === "conferido_gerente")
        .filter((s) => (s.apontamentosEscala || []).length > 0)
        .sort((a, b) => b.weekStart.localeCompare(a.weekStart)),
    [semanas],
  );

  async function marcarAjustado(s: ExcecaoStatusSemana, ap: ApontamentoEscala) {
    if (!me) return;
    try {
      await marcarApontamentoEscalaAjustado(rid, s.weekStart, s.weekEnd, ap.id, me);
      await recarregar();
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  }

  async function reabrir(s: ExcecaoStatusSemana, ap: ApontamentoEscala) {
    if (!confirm("Reabrir esse item? Vai voltar pra pendente.")) return;
    try {
      await reabrirApontamentoEscala(rid, s.weekStart, s.weekEnd, ap.id);
      await recarregar();
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  }

  if (loading) {
    return <div className="text-sm text-gray-500 dark:text-gray-400">Carregando…</div>;
  }
  if (erro) {
    return (
      <div className="rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3 text-sm text-rose-800 dark:text-rose-300">
        ❌ {erro}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-800 dark:text-blue-300">
        💡 Lista dos ajustes manuais a fazer na <strong>escala praticada</strong> (semanas
        conferidas pelo gerente). Inclui apenas itens que afetam escala — falta sem ajuste,
        marcação em dia de folga, etc. Itens de ponto que não mudam escala (intervalo curto,
        jornada longa) <strong>não entram aqui</strong>. Marque cada item como "✓ Ajustado" depois
        de lançar na praticada. <em>No futuro vamos conectar isso automaticamente.</em>
      </div>

      {/* Filtro por área — líder vê só a área dele */}
      <div className="flex flex-wrap gap-2">
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
      </div>

      {semanasConferidas.length === 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            Nenhuma semana conferida com apontamentos
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
            Aparece aqui depois que o gerente marca uma semana como "Conferido pelo gerente"
            na aba <strong>Inconformidades</strong>.
          </p>
        </div>
      )}

      {semanasConferidas.map((s) => (
        <SemanaBlock
          key={s.id}
          semana={s}
          areaByCpf={areaByCpf}
          filtroArea={filtroArea}
          onAjustar={(ap) => marcarAjustado(s, ap)}
          onReabrir={(ap) => reabrir(s, ap)}
        />
      ))}
    </div>
  );
}

function SemanaBlock({
  semana,
  areaByCpf,
  filtroArea,
  onAjustar,
  onReabrir,
}: {
  semana: ExcecaoStatusSemana;
  areaByCpf: Map<string, Area>;
  filtroArea: Area | "";
  onAjustar: (ap: ApontamentoEscala) => void;
  onReabrir: (ap: ApontamentoEscala) => void;
}) {
  const aps = semana.apontamentosEscala || [];
  // Agrupa por empregado e aplica filtro de área. ApontamentoEscala guarda
  // CPF no campo empregadoId (decisão histórica do helper) — daí o lookup
  // por CPF pra resolver área.
  const grupos = useMemo(() => {
    const m = new Map<string, ApontamentoEscala[]>();
    for (const a of aps) {
      if (filtroArea) {
        const area = areaByCpf.get(a.empregadoId);
        if (area !== filtroArea) continue;
      }
      const arr = m.get(a.empregadoId) || [];
      arr.push(a);
      m.set(a.empregadoId, arr);
    }
    return Array.from(m.entries())
      .map(([empregadoId, lista]) => ({
        empregadoId,
        empregadoNome: lista[0]?.empregadoNome ?? "",
        lista: lista.sort((a, b) => a.data.localeCompare(b.data)),
      }))
      .sort((a, b) => a.empregadoNome.localeCompare(b.empregadoNome));
  }, [aps, areaByCpf, filtroArea]);

  // Se o filtro deixou a semana sem itens, esconde o card inteiro
  if (filtroArea && grupos.length === 0) return null;

  const pendentes = aps.filter((a) => a.status === "pendente").length;
  const ajustados = aps.filter((a) => a.status === "ajustado").length;

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <header className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-bold text-gray-900 dark:text-gray-100 tabular-nums">
            Semana {fmtDataBr(semana.weekStart)} a {fmtDataBr(semana.weekEnd)}
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            {grupos.length} empregado(s) · {pendentes} pendente(s) · {ajustados} ajustado(s)
          </div>
        </div>
        <div className="text-[11px]">
          {pendentes === 0 ? (
            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-semibold">
              ✓ Tudo ajustado
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-semibold">
              ⏳ {pendentes} pendente(s)
            </span>
          )}
        </div>
      </header>

      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {grupos.map((g) => (
          <div key={g.empregadoId} className="px-4 py-3">
            <div className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {g.empregadoNome}
            </div>
            <ol className="space-y-1.5">
              {g.lista.map((a, i) => {
                const meta = REGRA_LABEL[a.ruleId] || { label: a.ruleId, icon: "•" };
                const ajustado = a.status === "ajustado";
                return (
                  <li key={a.id} className="flex items-start gap-2 text-sm">
                    <span className="text-gray-400 dark:text-gray-500 tabular-nums select-none mt-0.5 text-[11px]">
                      {i + 1}.
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap shrink-0 mt-0.5 ${
                        ajustado
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      }`}
                    >
                      {meta.icon} {meta.label}
                    </span>
                    <div className={`flex-1 min-w-0 ${ajustado ? "opacity-60" : ""}`}>
                      <div className="text-gray-800 dark:text-gray-200">
                        {a.texto}
                        <span className="text-[11px] text-gray-500 dark:text-gray-400 ml-1">
                          ({fmtDataBr(a.data)})
                        </span>
                      </div>
                      {ajustado && a.ajustadoEm && (
                        <div className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                          ✓ Ajustado por {a.ajustadoPorNome} em {fmtDataHora(a.ajustadoEm)}
                        </div>
                      )}
                    </div>
                    {ajustado ? (
                      <Button size="sm" variant="secondary" onClick={() => onReabrir(a)}>
                        ↩ reabrir
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => onAjustar(a)}>
                        ✓ Ajustado
                      </Button>
                    )}
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
