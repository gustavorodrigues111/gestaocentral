import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import {
  daysInMonth, fmtAnoMes, nomeMes, pad2, shiftMonth,
} from "../../core/utils/date";
import { derivedScheduleForEmpregado } from "../../core/escala/horarios";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { SolicitarAjusteModal } from "./SolicitarAjusteModal";
import type { Cargo, Empregado, EscalaMes, EscalaSolicitacao, ScheduleStatus } from "../../core/types";

const STATUS_INFO: Record<ScheduleStatus, { label: string; short: string; bg: string; text: string }> = {
  trabalho:  { label: "Trabalho",                short: "TR", bg: "bg-emerald-500",  text: "text-white" },
  folga:     { label: "Folga",                   short: "FO", bg: "bg-gray-300 dark:bg-gray-700",  text: "text-gray-700 dark:text-gray-200" },
  freela:    { label: "Freela",                  short: "FR", bg: "bg-purple-500",   text: "text-white" },
  comp:      { label: "Folga por compensação",   short: "FC", bg: "bg-amber-400",    text: "text-amber-950" },
  comp_trab: { label: "Trabalho por compensação", short: "TC", bg: "bg-amber-600",    text: "text-white" },
  ferias:    { label: "Férias",                  short: "FE", bg: "bg-sky-500",      text: "text-white" },
  falta_j:   { label: "Falta justificada",       short: "FJ", bg: "bg-rose-300",     text: "text-rose-900" },
  falta_i:   { label: "Falta injustificada",     short: "FI", bg: "bg-rose-600",     text: "text-white" },
};

type Props = {
  empregado: Empregado;
  cargo: Cargo | null;
  restaurantId: string;
};

export function MinhaEscalaTab({ empregado, cargo, restaurantId }: Props) {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [escala, setEscala] = useState<EscalaMes | null>(null);
  const { pessoa } = useAuth();
  const { can } = useCanAcao(restaurantId);
  const podeSolicitar = !!pessoa?.isMaster || can("portalEmpregado", "solicitarAjuste");

  const escalaId = `${restaurantId}_${fmtAnoMes(ano, mes)}`;
  useEffect(() => {
    const ref = doc(db, "escalas", escalaId);
    const unsub = onSnapshot(ref, (snap) => {
      setEscala(snap.exists() ? ({ id: snap.id, ...snap.data() } as EscalaMes) : null);
    });
    return () => unsub();
  }, [escalaId]);

  // Pedidos de ajuste pendentes do empregado (pra marcar os dias com ⏳).
  const [pendentes, setPendentes] = useState<Set<string>>(new Set());
  useEffect(() => {
    const q = query(collection(db, "escalaSolicitacoes"),
      where("restaurantId", "==", restaurantId), where("empregadoId", "==", empregado.id), where("status", "==", "pendente"));
    const unsub = onSnapshot(q, (snap) => {
      setPendentes(new Set(snap.docs.map((d) => (d.data() as EscalaSolicitacao).data).filter((x): x is string => !!x)));
    });
    return () => unsub();
  }, [restaurantId, empregado.id]);

  // Modal de solicitação.
  const [modalDia, setModalDia] = useState<{ data: string; status: ScheduleStatus | null; fonte: "real" | "prevista" | "derivado" | null; gorjetaPaga: boolean } | null>(null);
  async function abrirSolicitacao(date: string, status: ScheduleStatus | null, fonte: "real" | "prevista" | "derivado" | null) {
    if (!podeSolicitar) return;
    // Bloqueio: o dia já tem gorjeta PAGA? (publicada não basta)
    let gorjetaPaga = false;
    try {
      const gs = await getDocs(query(collection(db, "gorjetas"), where("restaurantId", "==", restaurantId), where("date", "==", date)));
      gorjetaPaga = gs.docs.some((d) => (d.data() as { paga?: boolean }).paga);
    } catch { /* ignora — best-effort */ }
    setModalDia({ data: date, status, fonte, gorjetaPaga });
  }

  // Derivado dos horários cadastrados
  const derivado = useMemo(
    () => derivedScheduleForEmpregado(empregado, ano, mes),
    [empregado, ano, mes],
  );

  // Versão a usar: priorizamos REAL (o que aconteceu); fallback Prevista; fallback derivado.
  // "fechado" = o dia foi processado pela análise de ponto (tem realAjustes) — NÃO
  // basta `real` existir (a praticada espelha a prevista antes de fechar).
  function statusEm(date: string): { status: ScheduleStatus | null; fonte: "real" | "prevista" | "derivado" | null; fechado: boolean } {
    const fechado = !!escala?.realAjustes?.[empregado.id]?.[date];
    const real = escala?.real?.[empregado.id]?.[date];
    if (real) return { status: real, fonte: "real", fechado };
    const prev = escala?.prevista?.[empregado.id]?.[date];
    if (prev) return { status: prev, fonte: "prevista", fechado };
    const der = derivado[date]?.status;
    if (der) return { status: der, fonte: "derivado", fechado };
    return { status: null, fonte: null, fechado };
  }

  const dias = daysInMonth(ano, mes);
  const todayYmd = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  })();

  // Stats: dias de trabalho / folga / férias / faltas no mês
  const stats = useMemo(() => {
    const m = { trabalho: 0, folga: 0, ferias: 0, falta: 0 };
    for (let d = 1; d <= dias; d++) {
      const date = `${ano}-${pad2(mes)}-${pad2(d)}`;
      const s = statusEm(date).status;
      if (!s) continue;
      if (s === "trabalho" || s === "comp_trab" || s === "freela") m.trabalho++;
      else if (s === "folga" || s === "comp") m.folga++;
      else if (s === "ferias") m.ferias++;
      else if (s === "falta_j" || s === "falta_i") m.falta++;
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escala, derivado, ano, mes, dias]);

  function navegarMes(delta: number) {
    const next = shiftMonth(ano, mes, delta);
    setAno(next.ano);
    setMes(next.mes);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {cargo?.nome || empregado.nome}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => navegarMes(-1)}>←</Button>
          <div className="px-4 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 font-medium text-sm min-w-[140px] text-center">
            {nomeMes(mes)} {ano}
          </div>
          <Button variant="secondary" size="sm" onClick={() => navegarMes(1)}>→</Button>
        </div>
      </div>

      {/* Banner de status da escala — informa ao empregado se a prevista
          ainda é só projeção do horário cadastrado, foi oficializada pela
          gestão, ou se o mês inteiro já foi fechado como praticada. */}
      <StatusEscalaBanner escala={escala} />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        <Mini label="Trabalho" value={stats.trabalho} variant="ok" />
        <Mini label="Folga" value={stats.folga} />
        <Mini label="Férias" value={stats.ferias} variant="info" />
        <Mini label="Faltas" value={stats.falta} variant={stats.falta > 0 ? "warn" : undefined} />
      </div>

      {/* Calendar grid */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
        <div className="grid grid-cols-7 gap-1 text-[10px] font-bold uppercase text-gray-500 mb-1 text-center">
          <div>Dom</div><div>Seg</div><div>Ter</div><div>Qua</div><div>Qui</div><div>Sex</div><div>Sáb</div>
        </div>
        <CalendarGrid
          ano={ano}
          mes={mes}
          dias={dias}
          statusEm={statusEm}
          todayYmd={todayYmd}
          pendentes={pendentes}
          podeSolicitar={podeSolicitar}
          onDiaClick={abrirSolicitacao}
        />
        {podeSolicitar && (
          <p className="text-[11px] text-gray-400 mt-2 text-center">Algum dia errado? Toque no dia pra solicitar um ajuste. 🔒 borda = dia fechado (praticada) · sem borda = prevista · tracejado = previsão · ⏳ = pedido pendente.</p>
        )}
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap gap-2 text-xs">
        {(Object.keys(STATUS_INFO) as ScheduleStatus[]).map(s => (
          <div key={s} className="flex items-center gap-1">
            <span className={`inline-flex items-center justify-center w-5 h-5 rounded ${STATUS_INFO[s].bg} ${STATUS_INFO[s].text} text-[9px] font-bold`}>
              {STATUS_INFO[s].short}
            </span>
            <span className="text-gray-600 dark:text-gray-400">{STATUS_INFO[s].label}</span>
          </div>
        ))}
      </div>

      {modalDia && pessoa && (
        <SolicitarAjusteModal
          rid={restaurantId}
          empregado={empregado}
          criadoPor={pessoa.id}
          data={modalDia.data}
          statusAtual={modalDia.status}
          fonteAtual={modalDia.fonte}
          gorjetaPaga={modalDia.gorjetaPaga}
          jaPendente={pendentes.has(modalDia.data)}
          onClose={() => setModalDia(null)}
          onCriado={() => setModalDia(null)}
        />
      )}
    </div>
  );
}

function CalendarGrid({
  ano, mes, dias, statusEm, todayYmd, pendentes, podeSolicitar, onDiaClick,
}: {
  ano: number; mes: number; dias: number;
  statusEm: (date: string) => { status: ScheduleStatus | null; fonte: "real" | "prevista" | "derivado" | null; fechado: boolean };
  todayYmd: string;
  pendentes: Set<string>;
  podeSolicitar: boolean;
  onDiaClick: (date: string, status: ScheduleStatus | null, fonte: "real" | "prevista" | "derivado" | null) => void;
}) {
  // Domingo do dia 1 (offset)
  const primeiroDia = new Date(ano, mes - 1, 1);
  const offset = primeiroDia.getDay();

  const cells: React.ReactNode[] = [];
  // Padding do início
  for (let i = 0; i < offset; i++) {
    cells.push(<div key={`pad-${i}`} className="aspect-square" />);
  }
  for (let d = 1; d <= dias; d++) {
    const date = `${ano}-${pad2(mes)}-${pad2(d)}`;
    const { status, fonte, fechado } = statusEm(date);
    const isToday = date === todayYmd;
    const dayDate = new Date(ano, mes - 1, d);
    const isWeekend = dayDate.getDay() === 0 || dayDate.getDay() === 6;
    const info = status ? STATUS_INFO[status] : null;
    const pend = pendentes.has(date);
    const cls = `relative aspect-square rounded flex flex-col items-center justify-center text-[10px] gap-0.5 ${
      info ? `${info.bg} ${info.text}` : "bg-gray-50 dark:bg-gray-800/40"
    } ${fonte === "derivado" ? "opacity-60 border border-dashed border-gray-300" : ""} ${
      fechado ? "border-2 border-gray-800/70 dark:border-white/70" : ""
    } ${isToday ? "ring-2 ring-indigo-500 ring-inset" : ""} ${podeSolicitar ? "cursor-pointer active:scale-95 transition-transform" : ""}`;
    const titulo = `${date} · ${info?.label || "Sem dado"} (${fechado ? "praticada · fechado" : fonte === "prevista" ? "prevista" : fonte === "derivado" ? "previsão" : "—"})${pend ? " · ajuste solicitado" : ""}${podeSolicitar ? " — toque pra solicitar ajuste" : ""}`;
    const conteudo = (
      <>
        {/* 🔒 = dia fechado (praticada); ⏳ = pedido pendente */}
        {fechado && <span className="absolute top-0.5 right-0.5 text-[8px] opacity-90 leading-none">🔒</span>}
        {pend && <span className="absolute top-0.5 left-0.5 text-[9px] leading-none">⏳</span>}
        <div className={`text-[9px] ${info ? "opacity-80" : "text-gray-500"}`}>
          {pad2(d)}{isWeekend && !info ? <span className="text-amber-600">·</span> : null}
        </div>
        {info && <div className="font-bold text-[11px]">{info.short}</div>}
      </>
    );
    cells.push(
      podeSolicitar
        ? <button key={d} type="button" onClick={() => onDiaClick(date, status, fonte)} className={cls} title={titulo}>{conteudo}</button>
        : <div key={d} className={cls} title={titulo}>{conteudo}</div>
    );
  }
  return <div className="grid grid-cols-7 gap-1">{cells}</div>;
}

// ─── Banner de status da escala ──────────────────────────────────────────
// Mostra ao empregado em que fase está a escala do mês selecionado:
//   • Praticada fechada → azul, "Mês finalizado" (read-only, é o registro final)
//   • Prevista fechada → verde, "Escala prevista oficial — aprovada pela gestão"
//   • Sem nada fechado → amarelo, "Baseada no seu horário cadastrado, ainda
//     pode mudar até a gestão aprovar"
function StatusEscalaBanner({ escala }: { escala: EscalaMes | null }) {
  if (escala?.fechadoEm) {
    return (
      <div className="rounded-lg border border-sky-200 dark:border-sky-800/40 bg-sky-50 dark:bg-sky-900/20 p-3 flex items-start gap-2">
        <span className="text-base shrink-0">🔒</span>
        <div className="text-xs text-sky-900 dark:text-sky-200">
          <p className="font-bold">Mês finalizado</p>
          <p className="mt-0.5">
            A escala praticada foi fechada pela gestão. Este é o registro
            final do mês — usado pra cálculo de gorjeta, VT e folha.
          </p>
        </div>
      </div>
    );
  }
  if (escala?.previstaFechadaEm) {
    return (
      <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-900/20 p-3 flex items-start gap-2">
        <span className="text-base shrink-0">✅</span>
        <div className="text-xs text-emerald-900 dark:text-emerald-200">
          <p className="font-bold">Escala prevista oficial</p>
          <p className="mt-0.5">
            A gestão fechou esta escala como prevista oficial do mês. Pode
            haver pequenos ajustes pontuais durante o mês (registrados na
            praticada), mas a estrutura está aprovada.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/20 p-3 flex items-start gap-2">
      <span className="text-base shrink-0">⏳</span>
      <div className="text-xs text-amber-900 dark:text-amber-200">
        <p className="font-bold">Ainda não é a escala prevista oficial</p>
        <p className="mt-0.5">
          O que você vê aqui é puxado do seu horário cadastrado — é uma
          previsão. Quando a gestão fechar a prevista do mês, um banner
          verde aparece aqui confirmando.
        </p>
      </div>
    </div>
  );
}

function Mini({ label, value, variant }: { label: string; value: number; variant?: "ok" | "warn" | "info" }) {
  const cls =
    variant === "ok" ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
    : variant === "warn" ? "border-rose-200 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300"
    : variant === "info" ? "border-sky-200 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300"
    : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100";
  return (
    <div className={`rounded-lg border p-2 text-center ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}
