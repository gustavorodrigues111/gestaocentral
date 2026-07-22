// Painel do módulo Segurança Sanitária (Fase 4). Visão agregada do restaurante:
// KPIs, evolução da nota (line chart SVG) e não-conformes por área acumulados.
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { Acao, SegurancaAvaliacao } from "../../core/types";
import { segAreaCor } from "../../core/types";
import { ouvirAvaliacoes } from "./repository";

const dmy = (ymd?: string | null) => (ymd || "").split("-").reverse().join("/");

export function Painel({ rid }: { rid: string }) {
  const [avaliacoes, setAvaliacoes] = useState<SegurancaAvaliacao[]>([]);
  const [acoes, setAcoes] = useState<Acao[]>([]);

  useEffect(() => { if (rid) return ouvirAvaliacoes(rid, setAvaliacoes); }, [rid]);
  useEffect(() => {
    if (!rid) return;
    return onSnapshot(query(collection(db, "acoes"), where("restaurantId", "==", rid)), (snap) => {
      setAcoes(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Acao).filter((a) => a.origem?.tipo === "avaliacao_sanitaria"));
    }, () => setAcoes([]));
  }, [rid]);

  // Finalizadas em ordem cronológica (por data; empate pelo iniciadoEm).
  const finalizadas = useMemo(() =>
    avaliacoes.filter((a) => a.status === "finalizada" && typeof a.score === "number")
      .sort((a, b) => (a.data || "").localeCompare(b.data || "") || (a.iniciadoEm || "").localeCompare(b.iniciadoEm || "")),
    [avaliacoes]);

  const ultimaNota = finalizadas.length ? finalizadas[finalizadas.length - 1].score! : null;
  const media = finalizadas.length ? Math.round(finalizadas.reduce((s, a) => s + (a.score || 0), 0) / finalizadas.length) : null;
  const abertas = acoes.filter((a) => a.status !== "concluida" && a.status !== "cancelada").length;
  const concluidas = acoes.filter((a) => a.status === "concluida").length;
  const taxaResolucao = acoes.length ? Math.round((concluidas / acoes.length) * 100) : null;

  // Lista de áreas (união de todas as avaliações — snapshot ou derivada).
  const areasLista = useMemo(() => Array.from(new Set(
    avaliacoes.flatMap((a) => a.areasSnapshot?.length ? a.areasSnapshot : (a.itensSnapshot || []).map((it) => it.area).filter(Boolean))
  )) as string[], [avaliacoes]);

  // Não-conformes por área (acumulado, todas as avaliações).
  const ncPorArea = useMemo(() => {
    const itemArea = new Map<string, string | undefined>();
    for (const a of avaliacoes) for (const it of a.itensSnapshot || []) itemArea.set(it.id, it.area);
    const m = {} as Record<string, number>;
    for (const a of avaliacoes) {
      const areaLocal = new Map<string, string | undefined>((a.itensSnapshot || []).map((it) => [it.id, it.area]));
      for (const [itemId, r] of Object.entries(a.resultado || {})) {
        if (r.resposta !== "nao_conforme") continue;
        const area = areaLocal.get(itemId) ?? itemArea.get(itemId);
        if (area) m[area] = (m[area] || 0) + 1;
      }
    }
    return areasLista.map((area) => ({ area, n: m[area] || 0 }));
  }, [avaliacoes, areasLista]);
  const maxArea = Math.max(1, ...ncPorArea.map((x) => x.n));

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Última nota" value={ultimaNota == null ? "—" : `${ultimaNota}%`} />
        <Kpi label="Média (finalizadas)" value={media == null ? "—" : `${media}%`} />
        <Kpi label="Ações abertas" value={String(abertas)} tone={abertas > 0 ? "warn" : "ok"} />
        <Kpi label="Taxa de resolução" value={taxaResolucao == null ? "—" : `${taxaResolucao}%`} tone="ok" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Evolução da nota */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Evolução da nota</div>
          {finalizadas.length < 2
            ? <p className="text-sm text-gray-400 py-6 text-center">{finalizadas.length === 0 ? "Nenhuma avaliação finalizada ainda." : "Uma avaliação só — o gráfico aparece a partir de duas."}</p>
            : <LineChart pontos={finalizadas.map((a) => ({ x: dmy(a.data), y: a.score || 0 }))} />}
        </div>

        {/* NC por área acumulado */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Não-conformes por área (acumulado)</div>
          {ncPorArea.every((x) => x.n === 0)
            ? <p className="text-sm text-gray-400 py-6 text-center">Nenhuma inconformidade registrada.</p>
            : <div className="space-y-2 pt-1">
                {ncPorArea.map((x) => (
                  <div key={x.area} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 text-[12px] text-gray-600 dark:text-gray-300 truncate">{x.area}</span>
                    <div className="flex-1 h-4 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden">
                      <div className="h-full rounded" style={{ width: `${(x.n / maxArea) * 100}%`, background: segAreaCor(x.area).dot }} />
                    </div>
                    <span className="w-6 shrink-0 text-right text-[12px] font-semibold tabular-nums text-gray-700 dark:text-gray-200">{x.n}</span>
                  </div>
                ))}
              </div>}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  const color = tone === "warn" ? "text-amber-600 dark:text-amber-400" : tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-gray-900 dark:text-gray-100";
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</div>
      <div className={`text-2xl font-extrabold tabular-nums mt-1 ${color}`}>{value}</div>
    </div>
  );
}

// Line chart SVG (0-100 no eixo Y). Último ponto destacado. Sem lib externa.
function LineChart({ pontos }: { pontos: { x: string; y: number }[] }) {
  const W = 320, H = 160, PAD_L = 26, PAD_B = 20, PAD_T = 8, PAD_R = 8;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const n = pontos.length;
  const px = (i: number) => PAD_L + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const py = (v: number) => PAD_T + (1 - v / 100) * plotH;
  const linha = pontos.map((p, i) => `${px(i)},${py(p.y)}`).join(" ");
  const gridY = [0, 25, 50, 75, 100];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Evolução da nota">
      {gridY.map((g) => (
        <g key={g}>
          <line x1={PAD_L} x2={W - PAD_R} y1={py(g)} y2={py(g)} stroke="currentColor" className="text-gray-200 dark:text-gray-800" strokeWidth={1} />
          <text x={PAD_L - 4} y={py(g) + 3} textAnchor="end" className="fill-gray-400 dark:fill-gray-500" fontSize={8}>{g}</text>
        </g>
      ))}
      <polyline points={linha} fill="none" stroke="#4f46e5" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {pontos.map((p, i) => {
        const last = i === n - 1;
        return <circle key={i} cx={px(i)} cy={py(p.y)} r={last ? 4.5 : 3} fill={last ? "#4f46e5" : "#fff"} stroke="#4f46e5" strokeWidth={last ? 2 : 1.5} />;
      })}
      {pontos.map((p, i) => (i === 0 || i === n - 1 || n <= 6) && (
        <text key={i} x={px(i)} y={H - 6} textAnchor="middle" className="fill-gray-400 dark:fill-gray-500" fontSize={7}>{p.x.slice(0, 5)}</text>
      ))}
    </svg>
  );
}
