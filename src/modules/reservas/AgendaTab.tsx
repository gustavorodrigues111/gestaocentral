// ════════════════════════════════════════════════════════════════════════════
//  Aba "Agenda de Disponibilidade" — visão operacional das janelas futuras.
//
//  Mostra todos os slots dos próximos N dias (default 30) com cor por
//  status:
//    🟢 normal         — slot do padrão semanal sem exceção
//    🔴 bloqueado      — exceção de bloqueio (escopo slot ou dia inteiro)
//    🟡 personalizado  — slot do padrão com override de salão/pax
//    🔵 extra          — slot criado manualmente fora do padrão semanal
//
//  Ações:
//    + Bloquear dia(s) → BloquearDatasModal (range de YYYY-MM-DD)
//    + Janela extra    → JanelaExtraModal   (data + horário + salões + pax)
//    Click no slot     → ações contextuais (bloquear/desbloquear/remover exc.)
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import {
  collection, deleteDoc, doc, onSnapshot, query, where,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import { todayYmd } from "../../core/utils/date";
import type {
  ConfiguracaoReservas, ExcecaoReserva, Salao, SiteConfig, SlotResolvido,
} from "../../core/types";
import {
  COR_STATUS_SLOT, resolverDisponibilidadePeriodo,
} from "../../core/reservas/disponibilidade";
import { BloquearDatasModal } from "./BloquearDatasModal";
import { JanelaExtraModal } from "./JanelaExtraModal";

type Props = {
  restaurantId: string;
  podeConfig: boolean;
  pessoaId: string;
  pessoaNome: string;
  saloes: Salao[];
};

type FiltroStatus = "todos" | "alterados";

const DIAS_PADRAO = 30;
const DIAS_OPCOES = [14, 30, 60, 90];

const NOMES_DIA = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
const NOMES_MES = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

function formatarData(ymd: string): { dia: string; diaSemana: string } {
  const d = new Date(ymd + "T12:00:00");
  return {
    dia: `${String(d.getDate()).padStart(2, "0")} ${NOMES_MES[d.getMonth()]}`,
    diaSemana: NOMES_DIA[d.getDay()] || "",
  };
}

export function AgendaTab({
  restaurantId, podeConfig, pessoaId, pessoaNome, saloes,
}: Props) {
  // ─── Dados (reativo) ───
  const [config, setConfig] = useState<ConfiguracaoReservas | null>(null);
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null);
  const [excecoes, setExcecoes] = useState<ExcecaoReserva[]>([]);

  // Filtros
  const [horizonte, setHorizonte] = useState(DIAS_PADRAO);
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("todos");

  // Modais
  const [openBloquear, setOpenBloquear] = useState(false);
  const [openExtra, setOpenExtra] = useState(false);
  // Pré-fill quando user clica "+ Janela extra" em uma data específica
  const [extraDataPrefill, setExtraDataPrefill] = useState<string | undefined>(undefined);

  // ─── Carrega configReservas ───
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "configReservas", restaurantId), (snap) => {
      setConfig(snap.exists() ? ({ id: snap.id, ...snap.data() } as ConfiguracaoReservas) : null);
    });
    return () => unsub();
  }, [restaurantId]);

  // ─── Carrega siteConfig (pra excecoes legadas: feriados/fechado) ───
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "sitesConfig", restaurantId), (snap) => {
      setSiteConfig(snap.exists() ? ({ id: snap.id, ...snap.data() } as SiteConfig) : null);
    });
    return () => unsub();
  }, [restaurantId]);

  // ─── Carrega excecoes granulares ───
  useEffect(() => {
    const q = query(collection(db, "excecoesReserva"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setExcecoes(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ExcecaoReserva));
    });
    return () => unsub();
  }, [restaurantId]);

  // ─── Resolve dias ───
  const hojeISO = todayYmd();
  const dias = useMemo(() => {
    if (!config) return [];
    return resolverDisponibilidadePeriodo(hojeISO, horizonte, {
      config,
      excecoesSite: siteConfig?.excecoes,
      excecoesReserva: excecoes,
    });
  }, [config, siteConfig?.excecoes, excecoes, horizonte, hojeISO]);

  // Filtra: se "alterados", mostra só dias que têm slot bloqueado/personalizado/extra
  // OU o dia inteiro está bloqueado
  const diasVisiveis = useMemo(() => {
    if (filtroStatus === "todos") return dias;
    return dias.filter(d =>
      d.diaBloqueado || d.slots.some(s => s.status !== "normal"),
    );
  }, [dias, filtroStatus]);

  // ─── Remove exceção (botão "↶ desfazer") ───
  async function removerExcecao(id: string) {
    if (!podeConfig) return;
    const ok = confirm("Remover essa exceção? O slot volta ao padrão semanal.");
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "excecoesReserva", id));
    } catch (e) {
      alert("Erro ao remover: " + (e instanceof Error ? e.message : "?"));
    }
  }

  if (!config) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400">
        Carregando agenda…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header — controles */}
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            📅 Agenda de Disponibilidade
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Veja, bloqueie ou adicione janelas pros próximos dias. As mudanças
            aqui sobrescrevem o padrão semanal pra datas específicas.
          </p>
        </div>
        {podeConfig && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setOpenBloquear(true)}>
              🚫 Bloquear dia(s)
            </Button>
            <Button size="sm" onClick={() => { setExtraDataPrefill(undefined); setOpenExtra(true); }}>
              + Janela extra
            </Button>
          </div>
        )}
      </div>

      {/* Legenda + filtros */}
      <div className="flex flex-wrap items-center gap-3 pb-3 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3 text-[11px] flex-wrap">
          <LegendaItem cor="emerald" label="Normal" />
          <LegendaItem cor="amber"   label="Personalizado" />
          <LegendaItem cor="sky"     label="Extra" />
          <LegendaItem cor="rose"    label="Bloqueado" />
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs text-gray-500 dark:text-gray-400">Horizonte</label>
          <select
            value={horizonte}
            onChange={(e) => setHorizonte(parseInt(e.target.value, 10))}
            className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          >
            {DIAS_OPCOES.map(n => <option key={n} value={n}>{n} dias</option>)}
          </select>
          <select
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value as FiltroStatus)}
            className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          >
            <option value="todos">Mostrar tudo</option>
            <option value="alterados">Só com alterações</option>
          </select>
        </div>
      </div>

      {/* Lista de dias */}
      {diasVisiveis.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 italic py-8 text-center">
          {filtroStatus === "alterados"
            ? "Nenhuma alteração nos próximos " + horizonte + " dias."
            : "Sem janelas configuradas pros próximos dias. Configure em Horários."}
        </div>
      ) : (
        <div className="space-y-2">
          {diasVisiveis.map((dia) => {
            const fmt = formatarData(dia.data);
            return (
              <div
                key={dia.data}
                className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 overflow-hidden"
              >
                <div className="px-3 py-2 flex items-center justify-between bg-gray-50 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                      {fmt.dia}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {fmt.diaSemana}
                    </span>
                  </div>
                  {dia.diaBloqueado ? (
                    <span className="text-[10px] uppercase tracking-wider font-bold text-rose-700 dark:text-rose-400">
                      🚫 {dia.motivoDiaBloqueado || "Bloqueado"}
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">
                      {dia.slots.length} janela{dia.slots.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                {!dia.diaBloqueado && dia.slots.length > 0 && (
                  <div className="p-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {dia.slots.map((slot, i) => (
                      <SlotCard
                        key={`${slot.horario}-${i}`}
                        slot={slot}
                        saloes={saloes}
                        podeConfig={podeConfig}
                        onRemoverExcecao={removerExcecao}
                      />
                    ))}
                  </div>
                )}
                {dia.diaBloqueado && podeConfig && (
                  <div className="p-2 flex justify-end gap-2 flex-wrap">
                    {/* Botão "desbloquear" — só se o bloqueio veio de excecaoReserva
                        (e não do SiteConfig.fechado). Achamos pelo motivo. */}
                    {excecoes.some(e =>
                      e.data === dia.data && e.escopo === "dia_inteiro" && e.tipo === "bloqueio",
                    ) && (
                      <button
                        type="button"
                        onClick={() => {
                          const exc = excecoes.find(e =>
                            e.data === dia.data && e.escopo === "dia_inteiro" && e.tipo === "bloqueio",
                          );
                          if (exc) removerExcecao(exc.id);
                        }}
                        className="text-[11px] px-2 py-1 rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        ↶ Desbloquear
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { setExtraDataPrefill(dia.data); setOpenExtra(true); }}
                      className="text-[11px] px-2 py-1 rounded bg-sky-100 hover:bg-sky-200 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300 dark:hover:bg-sky-900/60"
                    >
                      + Janela extra
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Modais ─── */}
      {openBloquear && (
        <BloquearDatasModal
          restaurantId={restaurantId}
          pessoaId={pessoaId}
          pessoaNome={pessoaNome}
          onClose={() => setOpenBloquear(false)}
        />
      )}
      {openExtra && (
        <JanelaExtraModal
          restaurantId={restaurantId}
          pessoaId={pessoaId}
          pessoaNome={pessoaNome}
          saloes={saloes}
          dataPrefill={extraDataPrefill}
          onClose={() => setOpenExtra(false)}
        />
      )}
    </div>
  );
}

// ─── Sub-componentes ────────────────────────────────────────────────

function LegendaItem({ cor, label }: { cor: string; label: string }) {
  const bgMap: Record<string, string> = {
    emerald: "bg-emerald-500",
    rose:    "bg-rose-500",
    amber:   "bg-amber-500",
    sky:     "bg-sky-500",
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${bgMap[cor]}`} />
      <span className="text-gray-600 dark:text-gray-400">{label}</span>
    </span>
  );
}

function SlotCard({
  slot, saloes, podeConfig, onRemoverExcecao,
}: {
  slot: SlotResolvido;
  saloes: Salao[];
  podeConfig: boolean;
  onRemoverExcecao: (id: string) => void;
}) {
  const cor = COR_STATUS_SLOT[slot.status];
  const saloesLabel = slot.salaoIds.length === 0
    ? "Sem salão atribuído"
    : slot.salaoIds
        .map(id => saloes.find(s => s.id === id)?.nome)
        .filter((x): x is string => !!x)
        .join(" + ") || "—";

  // Capacidade somada (informativa)
  const capacidadeTotal = slot.salaoIds.reduce((acc, id) => {
    const sal = saloes.find(s => s.id === id);
    if (!sal) return acc;
    if (sal.modeloCapacidade === "por_capacidade") {
      return acc + (sal.capacidadeMaxPax || 0);
    }
    return acc + (sal.numMesas || 0) * (sal.paxMaxPorMesa || 0);
  }, 0);
  const paxMax = slot.paxMaxOverride
    ? Math.min(capacidadeTotal, slot.paxMaxOverride)
    : capacidadeTotal;

  return (
    <div className={`rounded-md border ${cor.border} ${cor.bg} p-2.5`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-semibold ${cor.text} tabular-nums`}>
            {slot.horario}
          </div>
          <div className="text-[11px] text-gray-700 dark:text-gray-300 mt-0.5 truncate" title={saloesLabel}>
            {saloesLabel}
          </div>
          {paxMax > 0 && (
            <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
              até {paxMax} pax
              {slot.paxMaxOverride && (
                <span className="ml-1 italic">(limite custom)</span>
              )}
            </div>
          )}
          {slot.motivos.length > 0 && (
            <div className={`text-[10px] mt-1 italic ${cor.text}`}>
              💬 {slot.motivos[0]}
            </div>
          )}
        </div>
        <span className={`text-[9px] uppercase tracking-wider font-bold ${cor.text} whitespace-nowrap`}>
          {cor.label}
        </span>
      </div>
      {podeConfig && slot.excecoesIds.length > 0 && slot.status !== "personalizado" && (
        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button
            type="button"
            onClick={() => onRemoverExcecao(slot.excecoesIds[0]!)}
            className="text-[10px] px-2 py-0.5 rounded text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            ↶ Desfazer exceção
          </button>
        </div>
      )}
    </div>
  );
}
