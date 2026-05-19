import { useMemo, useState } from "react";
import { deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { AREAS, type Area, type Empregado, type FreelaShift, type Pessoa } from "../../core/types";
import { todayYmd } from "../../core/utils/date";
import { NovoTurnoModal } from "./NovoTurnoModal";
import { HorarioModal } from "./HorarioModal";
import { calcHoras, fmtHoras } from "./helpers";

type Props = {
  restaurantId: string;
  shifts: FreelaShift[];
  empregados: Empregado[];
  pessoas: Pessoa[];
  podeOperar: boolean;
};

type FiltroData = "todos" | "futuros" | "hoje" | "passado";
type FiltroArea = "todas" | Area;

const AREA_ICONE: Record<Area, string> = {
  Bar:     "🍷",
  Cozinha: "🍳",
  Salão:   "🍽️",
  Limpeza: "🧼",
};

// Tab Lançamentos — exclusivamente OPERACIONAL.
// Agrupada por ÁREA (Bar/Cozinha/Salão/Limpeza). Dentro: data asc + nome asc.
// Cards/linhas com cor de fundo sutil por estado:
//   📅 AGENDADO  (sem fundo)
//   🟡 ABERTO    (âmbar leve)
//   ✅ FECHADO   (verde leve) — aguarda DP precificar
export function LancamentoTab({
  restaurantId, shifts, empregados, pessoas, podeOperar,
}: Props) {
  const [filtroData, setFiltroData] = useState<FiltroData>("todos");
  const [filtroArea, setFiltroArea] = useState<FiltroArea>("todas");
  const [showNovo, setShowNovo] = useState(false);

  const hoje = todayYmd();
  const visiveis = useMemo(() => {
    return shifts
      .filter((s) => s.status === "agendado" || s.status === "aberto")
      .filter((s) => {
        if (filtroData === "todos")    return true;
        if (filtroData === "futuros")  return s.date > hoje;
        if (filtroData === "hoje")     return s.date === hoje;
        if (filtroData === "passado")  return s.date < hoje;
        return true;
      })
      .filter((s) => filtroArea === "todas" || s.area === filtroArea);
  }, [shifts, filtroData, filtroArea, hoje]);

  // Agrupa por área, em ordem fixa de AREAS. "Sem área" só aparece se houver legado.
  type Grupo = { area: Area | "__sem_area__"; nome: string; icone: string; rows: FreelaShift[] };
  const grupos: Grupo[] = useMemo(() => {
    const map = new Map<string, FreelaShift[]>();
    for (const s of visiveis) {
      const key = s.area || "__sem_area__";
      const arr = map.get(key) || [];
      arr.push(s);
      map.set(key, arr);
    }
    // sort dentro: data asc → nome asc
    for (const arr of map.values()) {
      arr.sort((a, b) =>
        a.date.localeCompare(b.date) || a.nomeSnapshot.localeCompare(b.nomeSnapshot),
      );
    }
    const out: Grupo[] = [];
    for (const a of AREAS) {
      const arr = map.get(a);
      if (arr && arr.length) out.push({ area: a, nome: a, icone: AREA_ICONE[a], rows: arr });
    }
    const semArea = map.get("__sem_area__");
    if (semArea && semArea.length) {
      out.unshift({ area: "__sem_area__", nome: "Sem área (legado — exclua e recrie)", icone: "⚠️", rows: semArea });
    }
    return out;
  }, [visiveis]);

  return (
    <div>
      {/* Filtros: data + área */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Pill ativo={filtroData === "todos"}   onClick={() => setFiltroData("todos")}>Todos</Pill>
          <Pill ativo={filtroData === "futuros"} onClick={() => setFiltroData("futuros")}>📅 Agendados</Pill>
          <Pill ativo={filtroData === "hoje"}    onClick={() => setFiltroData("hoje")}>Hoje</Pill>
          <Pill ativo={filtroData === "passado"} onClick={() => setFiltroData("passado")}>Passado</Pill>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {visiveis.length} turno(s)
          </span>
          {podeOperar && (
            <Button size="sm" onClick={() => setShowNovo(true)}>+ Novo turno</Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap mb-4">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mr-1">Área:</span>
        <Pill ativo={filtroArea === "todas"} onClick={() => setFiltroArea("todas")}>Todas</Pill>
        {AREAS.map((a) => (
          <Pill key={a} ativo={filtroArea === a} onClick={() => setFiltroArea(a)}>
            {AREA_ICONE[a]} {a}
          </Pill>
        ))}
      </div>

      {grupos.length === 0 ? (
        <EmptyState podeOperar={podeOperar} />
      ) : (
        <div className="space-y-5">
          {grupos.map((g) => (
            <AreaBlock key={g.area} grupo={g} podeOperar={podeOperar} />
          ))}
        </div>
      )}

      {showNovo && (
        <NovoTurnoModal
          restaurantId={restaurantId}
          empregados={empregados}
          pessoas={pessoas}
          onClose={() => setShowNovo(false)}
          onSaved={() => setShowNovo(false)}
        />
      )}
    </div>
  );
}

function Pill({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full transition-colors ${
        ativo
          ? "bg-indigo-600 text-white"
          : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState({ podeOperar }: { podeOperar: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
      Nenhum turno em aberto.
      {podeOperar && <> Clique em <strong>+ Novo turno</strong> pra criar.</>}
    </div>
  );
}

// ── Bloco de área (cabeçalho + tabela/lista) ──────────────────────────────
function AreaBlock({ grupo, podeOperar }: { grupo: { area: string; nome: string; icone: string; rows: FreelaShift[] }; podeOperar: boolean }) {
  return (
    <section className="rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-gray-900">
      <header className="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="text-sm font-bold text-gray-800 dark:text-gray-100">
          {grupo.icone} {grupo.nome.toUpperCase()}
        </div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400">
          {grupo.rows.length} turno(s)
        </div>
      </header>

      {/* Desktop: tabela */}
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 bg-gray-50/60 dark:bg-gray-800/30">
              <th className="px-4 py-2 w-24">Data</th>
              <th className="px-2 py-2">Pessoa</th>
              <th className="px-2 py-2 w-32">Estado</th>
              <th className="px-2 py-2">Horário</th>
              <th className="px-4 py-2 w-44 text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {grupo.rows.map((s) => (
              <RowDesktop key={s.id} shift={s} podeOperar={podeOperar} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards condensados */}
      <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-800">
        {grupo.rows.map((s) => (
          <RowMobile key={s.id} shift={s} podeOperar={podeOperar} />
        ))}
      </div>
    </section>
  );
}

// ── Helpers comuns dos cards/linhas ───────────────────────────────────────
type Estado = "agendado" | "aberto" | "fechado_ops";
function inferirEstado(s: FreelaShift): Estado {
  if (s.status === "agendado") return "agendado";
  if (s.entrada && s.saida)    return "fechado_ops";
  return "aberto";
}

const ESTADO_BADGE: Record<Estado, { txt: string; cls: string }> = {
  agendado:    { txt: "📅 AGENDADO", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  aberto:      { txt: "🟡 ABERTO",   cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  fechado_ops: { txt: "✅ FECHADO",  cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
};

const ESTADO_BG_ROW: Record<Estado, string> = {
  agendado:    "",
  aberto:      "bg-amber-50/40 dark:bg-amber-900/10",
  fechado_ops: "bg-emerald-50/40 dark:bg-emerald-900/10",
};

function fmtDataCurta(ymd: string): string {
  const [_a, m, d] = ymd.split("-");
  return `${d}/${m}`;
}

function horarioTexto(s: FreelaShift): string {
  const estado = inferirEstado(s);
  if (estado === "agendado") return s.entrada ? `prevista ${s.entrada}` : "—";
  if (estado === "aberto")   return `iniciou ${s.entrada}`;
  const h = calcHoras(s.entrada, s.saida, s.intervalo);
  const inter = s.intervalo ? ` (${s.intervalo}min)` : "";
  return `${s.entrada}→${s.saida}${inter} ${fmtHoras(h)}`;
}

// ── Linha desktop ─────────────────────────────────────────────────────────
function RowDesktop({ shift, podeOperar }: { shift: FreelaShift; podeOperar: boolean }) {
  const estado = inferirEstado(shift);
  const badge = ESTADO_BADGE[estado];
  return (
    <tr className={`border-t border-gray-100 dark:border-gray-800 ${ESTADO_BG_ROW[estado]}`}>
      <td className="px-4 py-2 text-gray-700 dark:text-gray-300 tabular-nums">
        {fmtDataCurta(shift.date)}
      </td>
      <td className="px-2 py-2">
        <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{shift.nomeSnapshot}</div>
        {shift.empregadoId && (
          <div className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400">Empregado</div>
        )}
      </td>
      <td className="px-2 py-2">
        <span className={`inline-block text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${badge.cls}`}>
          {badge.txt}
        </span>
      </td>
      <td className="px-2 py-2 text-xs text-gray-700 dark:text-gray-300">
        {horarioTexto(shift)}
        {shift.observacao && (
          <div className="text-[11px] text-gray-500 italic truncate">"{shift.observacao}"</div>
        )}
      </td>
      <td className="px-4 py-2 text-right">
        <RowAcoes shift={shift} podeOperar={podeOperar} />
      </td>
    </tr>
  );
}

// ── Linha mobile (condensada) ─────────────────────────────────────────────
function RowMobile({ shift, podeOperar }: { shift: FreelaShift; podeOperar: boolean }) {
  const estado = inferirEstado(shift);
  const badge = ESTADO_BADGE[estado];
  return (
    <div className={`px-3 py-3 ${ESTADO_BG_ROW[estado]}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">
            {fmtDataCurta(shift.date)}
          </div>
          <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
            {shift.nomeSnapshot}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${badge.cls}`}>
              {badge.txt}
            </span>
            {shift.empregadoId && (
              <span className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400 bg-amber-100/70 dark:bg-amber-900/30 px-1.5 py-0.5 rounded">
                Empregado
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="text-xs text-gray-700 dark:text-gray-300 mb-2">
        {horarioTexto(shift)}
        {shift.observacao && (
          <div className="text-[11px] text-gray-500 italic">"{shift.observacao}"</div>
        )}
      </div>
      <div className="flex justify-end">
        <RowAcoes shift={shift} podeOperar={podeOperar} />
      </div>
    </div>
  );
}

// ── Ações da linha (botões + modais) ──────────────────────────────────────
function RowAcoes({ shift, podeOperar }: { shift: FreelaShift; podeOperar: boolean }) {
  const { pessoa: me } = useAuth();
  const [horarioMode, setHorarioMode] = useState<"iniciar" | "fechar" | "editar" | "lancar" | null>(null);
  const [saving, setSaving] = useState(false);
  const estado = inferirEstado(shift);

  async function naoCompareceu() {
    if (!me) return;
    if (!confirm(`Marcar ${shift.nomeSnapshot} como NÃO COMPARECEU?\nEsse turno não gera pagamento.`)) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "freelaShifts", shift.id), {
        status: "nao_compareceu",
        noShowEm: new Date().toISOString(),
        noShowPor: me.id,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setSaving(false);
    }
  }

  async function excluir() {
    if (!confirm(`Excluir turno de ${shift.nomeSnapshot} em ${shift.date}?`)) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, "freelaShifts", shift.id));
    } finally {
      setSaving(false);
    }
  }

  if (!podeOperar) return null;

  return (
    <>
      <div className="inline-flex items-center gap-2 flex-wrap justify-end">
        {estado === "agendado" && (
          <Button size="sm" onClick={() => setHorarioMode("lancar")} disabled={saving}>🟢 Lançar</Button>
        )}
        {estado === "aberto" && (
          <Button size="sm" onClick={() => setHorarioMode("fechar")} disabled={saving}>🔴 Fechar</Button>
        )}
        {estado === "fechado_ops" && (
          <Button size="sm" variant="secondary" onClick={() => setHorarioMode("editar")} disabled={saving}>✏️ Editar</Button>
        )}
        <button type="button" onClick={excluir} disabled={saving} aria-label="Excluir" className="text-[18px] text-gray-400 hover:text-red-600 dark:hover:text-red-400 leading-none p-1 disabled:opacity-50">
          🗑
        </button>
        {estado !== "fechado_ops" && (
          <button type="button" onClick={naoCompareceu} disabled={saving} aria-label="Não compareceu" className="text-[16px] leading-none p-1 disabled:opacity-50" title="Não compareceu">
            🚫
          </button>
        )}
      </div>
      {horarioMode && (
        <HorarioModal
          shift={shift}
          mode={horarioMode}
          onClose={() => setHorarioMode(null)}
          onSaved={() => setHorarioMode(null)}
        />
      )}
    </>
  );
}
