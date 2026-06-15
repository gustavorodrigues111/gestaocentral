import { useState } from "react";
import { deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { type Empregado, type FreelaShift, type Pessoa } from "../../core/types";
import { todayYmd } from "../../core/utils/date";
import { NovoTurnoModal } from "./NovoTurnoModal";
import { HorarioModal } from "./HorarioModal";
import { calcHoras, fmtHoras, intervaloTotalDoShift, somaIntervalos } from "./helpers";

type Props = {
  restaurantId: string;
  shifts: FreelaShift[];
  empregados: Empregado[];
  pessoas: Pessoa[];
  podeOperar: boolean;
  // "Planejar turnos" e "Abrir turno" vêm do header da página (FreelasPage).
  showNovo?: boolean;
  onCloseNovo?: () => void;
  showAvulso?: boolean;
  onCloseAvulso?: () => void;
};

// Conceito FIXO (planejar ≠ executar):
//   • Planejado (status agendado): só plano. No dia, sobe pra "Turnos do dia".
//   • Abrir turno (botão) → confirma ENTRADA real → aberto.
//   • Fechar turno (botão) → confirma SAÍDA + INTERVALOS reais → realizado.
type Zona = "planejado_futuro" | "abrir" | "fechar" | "realizado" | "outro";
function zonaDoShift(s: FreelaShift, hoje: string): Zona {
  if (s.status === "agendado") return s.date > hoje ? "planejado_futuro" : "abrir";
  if (s.status === "aberto") return s.saida ? "realizado" : "fechar";
  return "outro";
}

export function LancamentoTab({
  restaurantId, shifts, empregados, pessoas, podeOperar,
  showNovo: showNovoExt, onCloseNovo,
  showAvulso: showAvulsoExt, onCloseAvulso,
}: Props) {
  const hoje = todayYmd();
  const [showPlanejarLocal, setShowPlanejarLocal] = useState(false);
  const [showAvulsoLocal, setShowAvulsoLocal] = useState(false);
  const [realizadosOpen, setRealizadosOpen] = useState(false);

  const usaExterno = showNovoExt !== undefined;
  const showPlanejar = usaExterno ? !!showNovoExt : showPlanejarLocal;
  const fecharPlanejar = () => { if (usaExterno) onCloseNovo?.(); else setShowPlanejarLocal(false); };

  const usaExternoAvulso = showAvulsoExt !== undefined;
  const showAvulso = usaExternoAvulso ? !!showAvulsoExt : showAvulsoLocal;
  const fecharAvulso = () => { if (usaExternoAvulso) onCloseAvulso?.(); else setShowAvulsoLocal(false); };

  const ordenarData = (a: FreelaShift, b: FreelaShift) =>
    a.date.localeCompare(b.date) || a.nomeSnapshot.localeCompare(b.nomeSnapshot);

  const turnosDoDia = shifts
    .filter((s) => { const z = zonaDoShift(s, hoje); return z === "abrir" || z === "fechar"; })
    .sort(ordenarData);
  const planejados = shifts
    .filter((s) => zonaDoShift(s, hoje) === "planejado_futuro")
    .sort(ordenarData);
  const realizados = shifts
    .filter((s) => zonaDoShift(s, hoje) === "realizado")
    .sort((a, b) => ordenarData(b, a)); // mais recentes primeiro

  return (
    <div className="space-y-5">
      {/* ── Zona 1: Turnos do dia ─────────────────────────────────────────── */}
      <section>
        <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-2">🟢 Turnos do dia</h3>
        {turnosDoDia.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500">
            Nenhum turno pra abrir ou fechar hoje.
            {podeOperar && <> Use <strong>Abrir turno</strong> (no topo) ou planeje turnos.</>}
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
            {turnosDoDia.map((s) => <RowTurno key={s.id} shift={s} hoje={hoje} podeOperar={podeOperar} />)}
          </div>
        )}
      </section>

      {/* ── Zona 2: Planejados (futuros) — discreto ───────────────────────── */}
      {planejados.length > 0 && (
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5 px-1">
            📅 Planejados ({planejados.length})
          </h3>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-white/60 dark:bg-gray-900/40 divide-y divide-gray-100 dark:divide-gray-800">
            {planejados.map((s) => <RowTurno key={s.id} shift={s} hoje={hoje} podeOperar={podeOperar} />)}
          </div>
        </section>
      )}

      {/* ── Zona 3: Realizados — expansível ───────────────────────────────── */}
      {realizados.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setRealizadosOpen((v) => !v)}
            className="w-full flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5 px-1 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <span className={`transition-transform ${realizadosOpen ? "" : "-rotate-90"}`}>▾</span>
            ✅ Realizados ({realizados.length})
            <span className="font-normal normal-case tracking-normal text-gray-400">aguardando o DP precificar</span>
          </button>
          {realizadosOpen && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
              {realizados.map((s) => <RowTurno key={s.id} shift={s} hoje={hoje} podeOperar={podeOperar} />)}
            </div>
          )}
        </section>
      )}

      {/* ── Modais ────────────────────────────────────────────────────────── */}
      {showPlanejar && (
        <NovoTurnoModal
          modo="planejar"
          restaurantId={restaurantId}
          empregados={empregados}
          pessoas={pessoas}
          onClose={fecharPlanejar}
          onSaved={fecharPlanejar}
        />
      )}
      {showAvulso && (
        <NovoTurnoModal
          modo="avulso"
          restaurantId={restaurantId}
          empregados={empregados}
          pessoas={pessoas}
          onClose={fecharAvulso}
          onSaved={fecharAvulso}
        />
      )}
    </div>
  );
}

// ── Texto de horário por zona ───────────────────────────────────────────────
function fmtDataCurta(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
}
function textoHorario(s: FreelaShift, zona: Zona): string {
  if (zona === "planejado_futuro" || zona === "abrir") {
    const prevInt = somaIntervalos(s.intervalosPrevistos);
    const fim = s.saidaPrevista ? ` → ${s.saidaPrevista}` : "";
    const base = (s.entradaPrevista || s.saidaPrevista) ? `prevista ${s.entradaPrevista || "?"}${fim}` : "sem horário previsto";
    return base + (prevInt ? ` · ⏸️ ${prevInt}min` : "");
  }
  if (zona === "fechar") {
    const tot = intervaloTotalDoShift(s);
    return `entrou ${s.entrada || "?"}` + (tot ? ` · ⏸️ ${tot}min` : "");
  }
  // realizado
  const tot = intervaloTotalDoShift(s);
  const h = calcHoras(s.entrada, s.saida, tot);
  return `${s.entrada}→${s.saida}${tot ? ` (${tot}min)` : ""} ${fmtHoras(h)}`;
}

const ZONA_BADGE: Record<Zona, { txt: string; cls: string }> = {
  planejado_futuro: { txt: "📅 PLANEJADO", cls: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
  abrir:            { txt: "📅 PLANEJADO", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  fechar:           { txt: "🟡 ABERTO",    cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  realizado:        { txt: "✅ REALIZADO", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  outro:            { txt: "", cls: "" },
};

// Cor da borda esquerda do card por status (o "box muda pela cor").
const ZONA_CARD: Record<Zona, string> = {
  planejado_futuro: "border-l-gray-300 dark:border-l-gray-700",
  abrir:            "border-l-blue-400 dark:border-l-blue-500",
  fechar:           "border-l-amber-400 dark:border-l-amber-500",
  realizado:        "border-l-emerald-400 dark:border-l-emerald-500",
  outro:            "border-l-transparent",
};

// ── Linha de turno (display + ações por zona) ───────────────────────────────
function RowTurno({ shift, hoje, podeOperar }: { shift: FreelaShift; hoje: string; podeOperar: boolean }) {
  const { pessoa: me } = useAuth();
  const [modalMode, setModalMode] = useState<"abrir" | "fechar" | "editar" | "intervalo" | null>(null);
  const [saving, setSaving] = useState(false);
  const zona = zonaDoShift(shift, hoje);
  const badge = ZONA_BADGE[zona];
  const discreto = zona === "planejado_futuro";

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
    } finally { setSaving(false); }
  }
  async function excluir() {
    if (!confirm(`Excluir turno de ${shift.nomeSnapshot} em ${fmtDataCurta(shift.date)}?`)) return;
    setSaving(true);
    try { await deleteDoc(doc(db, "freelaShifts", shift.id)); }
    finally { setSaving(false); }
  }

  const temAcoes = podeOperar && zona !== "outro";

  return (
    <div className={`px-3 py-2.5 border-l-4 ${ZONA_CARD[zona]} ${discreto ? "opacity-80" : ""}`}>
      {/* status */}
      {badge.txt && (
        <span className={`inline-block text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold whitespace-nowrap ${badge.cls}`}>{badge.txt}</span>
      )}
      {/* nome completo, em destaque */}
      <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 mt-1 break-words">{shift.nomeSnapshot}</div>
      {/* data · setor */}
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
        <span className="tabular-nums">{fmtDataCurta(shift.date)}</span>
        {shift.area && <span> · {shift.area}</span>}
      </div>

      {/* botões de ação (linha própria — não espremem o texto) */}
      {temAcoes && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {zona === "abrir" && (
            <Button size="sm" onClick={() => setModalMode("abrir")} disabled={saving}>🟢 Abrir turno</Button>
          )}
          {zona === "fechar" && (
            <>
              <Button size="sm" variant="secondary" onClick={() => setModalMode("intervalo")} disabled={saving}>⏸️ Intervalo</Button>
              <Button size="sm" onClick={() => setModalMode("fechar")} disabled={saving}>🔴 Fechar turno</Button>
            </>
          )}
          {zona === "realizado" && (
            <Button size="sm" variant="secondary" onClick={() => setModalMode("editar")} disabled={saving}>✏️ Editar</Button>
          )}
          {(zona === "abrir" || zona === "fechar") && (
            <button type="button" onClick={naoCompareceu} disabled={saving} title="Não compareceu" className="text-[16px] leading-none p-1 disabled:opacity-50">🚫</button>
          )}
          {zona !== "realizado" && (
            <button type="button" onClick={excluir} disabled={saving} aria-label="Excluir" className="ml-auto text-[18px] text-gray-400 hover:text-red-600 dark:hover:text-red-400 leading-none p-1 disabled:opacity-50">🗑</button>
          )}
        </div>
      )}

      {/* horário: entrou · intervalo · saiu (ou prevista, pra planejados) */}
      <div className="text-xs text-gray-600 dark:text-gray-300 mt-1.5">{textoHorario(shift, zona)}</div>

      {modalMode && (
        <HorarioModal shift={shift} mode={modalMode} onClose={() => setModalMode(null)} onSaved={() => setModalMode(null)} />
      )}
    </div>
  );
}
