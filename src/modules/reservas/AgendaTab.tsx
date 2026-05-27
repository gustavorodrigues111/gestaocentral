// ════════════════════════════════════════════════════════════════════════════
//  Aba "Agenda de Disponibilidade" — calendário semanal
//
//  Grid de 7 colunas (Dom-Sáb). Navegação por semana (◀ ▶) com botão "hoje".
//  Cada coluna mostra a data + lista vertical dos slots do dia, cada um
//  clicável (abre SlotEditarModal pra editar/bloquear/personalizar).
//
//  Cores por status:
//    🟢 normal         — slot do padrão semanal sem exceção
//    🔴 bloqueado      — exceção de bloqueio
//    🟡 personalizado  — slot do padrão com override
//    🔵 extra          — slot criado manualmente
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import {
  collection, doc, onSnapshot, query, where,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { todayYmd } from "../../core/utils/date";
import type {
  ConfiguracaoReservas, DiaResolvido, ExcecaoReserva, Salao, SiteConfig,
  SlotResolvido,
} from "../../core/types";
import {
  COR_STATUS_SLOT, resolverDisponibilidadePeriodo,
} from "../../core/reservas/disponibilidade";
import { JanelaExtraModal } from "./JanelaExtraModal";
import { SlotEditarModal } from "./SlotEditarModal";
import { DiaAcoesModal } from "./DiaAcoesModal";

type Props = {
  restaurantId: string;
  podeConfig: boolean;
  pessoaId: string;
  pessoaNome: string;
  saloes: Salao[];
};

const NOMES_DIA_CURTO = ["dom","seg","ter","qua","qui","sex","sáb"];
const NOMES_MES = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

// Calcula a segunda-feira da semana de uma data (início da semana — padrão BR).
// getDay() retorna 0=dom, 1=seg, ..., 6=sáb. Pra chegar na segunda da semana:
//   - se hoje é dom (0)  → volta 6 dias
//   - se hoje é seg (1)  → volta 0 dias
//   - se hoje é ter (2)  → volta 1 dia
//   - ...etc.
function segundaDaSemana(ymd: string): string {
  const d = new Date(ymd + "T12:00:00");
  const dow = d.getDay();
  const delta = dow === 0 ? 6 : dow - 1;
  d.setDate(d.getDate() - delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtRangeSemana(inicio: string): string {
  const fim = addDays(inicio, 6);
  const a = new Date(inicio + "T12:00:00");
  const b = new Date(fim + "T12:00:00");
  const mesA = NOMES_MES[a.getMonth()];
  const mesB = NOMES_MES[b.getMonth()];
  if (a.getMonth() === b.getMonth()) {
    return `${a.getDate()}–${b.getDate()} ${mesA}`;
  }
  return `${a.getDate()} ${mesA} – ${b.getDate()} ${mesB}`;
}

// Capacidade-base do salão (sem considerar paxMaxOverride do slot).
// Por capacidade: total do salão. Por mesas: nº mesas × pax máx por mesa.
export function paxDoSalao(s: Salao): number {
  if (s.modeloCapacidade === "por_capacidade") return s.capacidadeMaxPax || 0;
  return (s.numMesas || 0) * (s.paxMaxPorMesa || 0);
}

export function AgendaTab({
  restaurantId, podeConfig, pessoaId, pessoaNome, saloes,
}: Props) {
  // ─── Dados (reativo) ───
  const [config, setConfig] = useState<ConfiguracaoReservas | null>(null);
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null);
  const [excecoes, setExcecoes] = useState<ExcecaoReserva[]>([]);

  // Navegação de semana (sempre começa na segunda)
  const hojeISO = todayYmd();
  const [segundaAtual, setSegundaAtual] = useState(() => segundaDaSemana(hojeISO));

  // Modais
  const [openExtra, setOpenExtra] = useState(false);
  const [extraDataPrefill, setExtraDataPrefill] = useState<string | undefined>(undefined);
  // Modal de slot — quando user clica num slot
  const [slotEditando, setSlotEditando] = useState<{ data: string; slot: SlotResolvido } | null>(null);
  // Modal de ações por dia — quando user clica no header da coluna
  const [diaAcoes, setDiaAcoes] = useState<string | null>(null);

  // ─── Carrega configReservas ───
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "configReservas", restaurantId), (snap) => {
      setConfig(snap.exists() ? ({ id: snap.id, ...snap.data() } as ConfiguracaoReservas) : null);
    });
    return () => unsub();
  }, [restaurantId]);

  // ─── Carrega siteConfig (excecoes legadas) ───
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

  // ─── Resolve os 7 dias da semana visível ───
  const dias = useMemo(() => {
    if (!config) return [];
    return resolverDisponibilidadePeriodo(segundaAtual, 7, {
      config,
      excecoesSite: siteConfig?.excecoes,
      excecoesReserva: excecoes,
    });
  }, [config, siteConfig?.excecoes, excecoes, segundaAtual]);

  // Mapa de excecoes por data (passado pro modal)
  const excecoesPorData = useMemo(() => {
    const m = new Map<string, ExcecaoReserva[]>();
    for (const exc of excecoes) {
      const arr = m.get(exc.data) || [];
      arr.push(exc);
      m.set(exc.data, arr);
    }
    return m;
  }, [excecoes]);

  function semanaPassada() { setSegundaAtual(prev => addDays(prev, -7)); }
  function semanaProxima() { setSegundaAtual(prev => addDays(prev, +7)); }
  function irPraHoje()     { setSegundaAtual(segundaDaSemana(hojeISO)); }

  if (!config) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400">
        Carregando agenda…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          🗓️ Agenda de Disponibilidade
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Clica numa janela pra editar · no cabeçalho do dia pra bloquear · no
          botão azul pra adicionar nova janela.
        </p>
      </div>

      {/* Navegação de semana + legenda */}
      <div className="flex flex-wrap items-center gap-3 pb-3 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={semanaPassada}
            className="px-2.5 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Semana anterior"
          >
            ◀
          </button>
          <button
            type="button"
            onClick={irPraHoje}
            className="px-3 py-1 text-xs font-semibold rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Hoje
          </button>
          <button
            type="button"
            onClick={semanaProxima}
            className="px-2.5 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Próxima semana"
          >
            ▶
          </button>
          <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {fmtRangeSemana(segundaAtual)}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] flex-wrap ml-auto">
          <LegendaItem cor="emerald" label="Normal" />
          <LegendaItem cor="amber"   label="Personalizado" />
          <LegendaItem cor="sky"     label="Extra" />
          <LegendaItem cor="rose"    label="Bloqueado" />
        </div>
      </div>

      {/* Grid semanal — 7 colunas em desktop ≥ md (768px), stack vertical
          em mobile com gap maior pra dar respiro entre dias. */}
      <div className="grid grid-cols-1 md:grid-cols-7 gap-5 md:gap-2">
        {dias.map((dia, i) => (
          <DiaColuna
            key={dia.data}
            dia={dia}
            ehHoje={dia.data === hojeISO}
            // Semana começa na segunda → sáb e dom são os 2 últimos (i=5,6)
            ehFimSemana={i === 5 || i === 6}
            saloes={saloes}
            podeConfig={podeConfig}
            onClickSlot={(slot) => setSlotEditando({ data: dia.data, slot })}
            onClickHeader={() => podeConfig && setDiaAcoes(dia.data)}
            onClickAdicionarExtra={() => {
              setExtraDataPrefill(dia.data);
              setOpenExtra(true);
            }}
          />
        ))}
      </div>

      {/* ─── Modais ─── */}
      {diaAcoes && (
        <DiaAcoesModal
          data={diaAcoes}
          restaurantId={restaurantId}
          pessoaId={pessoaId}
          pessoaNome={pessoaNome}
          excecoesNaData={excecoesPorData.get(diaAcoes) || []}
          onAdicionarJanelaExtra={() => {
            setExtraDataPrefill(diaAcoes);
            setOpenExtra(true);
          }}
          onClose={() => setDiaAcoes(null)}
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
      {slotEditando && (
        <SlotEditarModal
          data={slotEditando.data}
          slot={slotEditando.slot}
          restaurantId={restaurantId}
          pessoaId={pessoaId}
          pessoaNome={pessoaNome}
          saloes={saloes}
          excecoesNaData={excecoesPorData.get(slotEditando.data) || []}
          onClose={() => setSlotEditando(null)}
        />
      )}
    </div>
  );
}

// ─── Coluna de um dia ─────────────────────────────────────────────────

function DiaColuna({
  dia, ehHoje, ehFimSemana, saloes, podeConfig, onClickSlot, onClickHeader, onClickAdicionarExtra,
}: {
  dia: DiaResolvido;
  ehHoje: boolean;
  ehFimSemana: boolean;
  saloes: Salao[];
  podeConfig: boolean;
  onClickSlot: (slot: SlotResolvido) => void;
  /** Click no header → DiaAcoesModal (bloquear/desbloquear dia inteiro). */
  onClickHeader: () => void;
  /** Click no botão + azul no fim da coluna → JanelaExtraModal prefilled. */
  onClickAdicionarExtra: () => void;
}) {
  const d = new Date(dia.data + "T12:00:00");
  const dia2 = String(d.getDate()).padStart(2, "0");
  const mes = NOMES_MES[d.getMonth()];
  const diaSemana = NOMES_DIA_CURTO[d.getDay()];

  // Header da coluna: hoje destaca em indigo; fins de semana em tom mais quente.
  // Mobile usa fundo mais saturado + barra lateral pra separar dias visualmente.
  const headerBg = ehHoje
    ? "bg-indigo-100 dark:bg-indigo-900/40 border-indigo-300 dark:border-indigo-800"
    : ehFimSemana
      ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-900"
      : "bg-gray-50 dark:bg-gray-900/60 border-gray-200 dark:border-gray-800";
  const headerText = ehHoje
    ? "text-indigo-900 dark:text-indigo-200"
    : "text-gray-700 dark:text-gray-300";
  // Cor da barra lateral mobile pra separar dias visualmente
  const barraLateralCor = ehHoje
    ? "bg-indigo-500 dark:bg-indigo-400"
    : ehFimSemana
      ? "bg-amber-500 dark:bg-amber-400"
      : "bg-gray-400 dark:bg-gray-600";

  const headerClickable = podeConfig
    ? "cursor-pointer hover:brightness-95 dark:hover:brightness-110 transition-all"
    : "";

  return (
    // h-full + flex-col → coluna estica até a altura do dia mais cheio (grid
    // items-stretch é default). Área central usa flex-1 pra preencher; assim
    // o botão "+ nova janela" do rodapé fica alinhado entre todas as colunas.
    // Mobile: borda lateral colorida pra demarcar visualmente cada dia.
    <div className="h-full flex md:block">
      {/* Barra lateral só no mobile — destaque visual entre dias */}
      <div className={`md:hidden w-1.5 ${barraLateralCor} rounded-l-md flex-shrink-0`} />
      <div className="flex-1 flex flex-col gap-1.5 min-w-0">
        {/* Header da coluna — clicável pra ações do dia inteiro.
            Mobile: padding e fonte maiores, label "HOJE" quando aplicável. */}
        <button
          type="button"
          onClick={onClickHeader}
          disabled={!podeConfig}
          className={`px-3 py-2.5 md:px-2 md:py-1.5 rounded-md border-2 md:border ${headerBg} text-left md:text-center w-full ${headerClickable} disabled:cursor-default`}
          title={podeConfig ? "Ações desse dia" : ""}
        >
          {/* Mobile: linha única alta com dia da semana + data grandes */}
          <div className="md:hidden flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className={`text-base font-bold uppercase tracking-wide ${headerText}`}>
                {diaSemana}
              </span>
              {ehHoje && (
                <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-600 text-white">
                  hoje
                </span>
              )}
            </div>
            <span className={`text-lg font-bold ${headerText} tabular-nums`}>
              {dia2} <span className="text-sm font-normal opacity-70">{mes}</span>
            </span>
          </div>
          {/* Desktop: dia da semana em cima, número e mês embaixo */}
          <div className="hidden md:block">
            <div className={`text-[10px] uppercase tracking-wider font-bold ${headerText}`}>
              {diaSemana}
            </div>
            <div className={`text-base font-bold ${headerText} tabular-nums leading-tight`}>
              {dia2}
            </div>
            <div className={`text-[9px] ${headerText} opacity-70`}>{mes}</div>
          </div>
        </button>

      {/* Área central — flex-1 pra esticar a coluna e manter o botão
          "+ nova janela" alinhado no rodapé. Os boxes internos têm altura
          fixa de 1 slot (CHIP_HEIGHT) — colunas com poucos slots ganham
          espaço vazio embaixo, mas o box vermelho/sem-janelas não estica. */}
      <div className="flex-1 flex flex-col gap-1.5 min-h-0">
        {dia.diaBloqueado ? (
          <button
            type="button"
            disabled={!podeConfig}
            onClick={onClickHeader}
            className={`${CHIP_HEIGHT} px-2 py-1.5 rounded-md border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-900/10 text-center flex flex-col items-center justify-center gap-1 hover:bg-rose-100 dark:hover:bg-rose-900/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed overflow-hidden`}
            title={podeConfig ? "Gerenciar bloqueio do dia" : ""}
          >
            <span className="text-sm leading-none">🚫</span>
            <span className="text-[10px] uppercase tracking-wider font-bold text-rose-700 dark:text-rose-400 leading-tight line-clamp-2">
              {dia.motivoDiaBloqueado || "Bloqueado"}
            </span>
          </button>
        ) : dia.slots.length === 0 ? (
          <div className={`${CHIP_HEIGHT} p-2 text-center text-[10px] text-gray-400 dark:text-gray-600 italic flex items-center justify-center`}>
            sem janelas
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {dia.slots.map((slot, i) => (
              <SlotChip
                key={`${slot.horario}-${i}`}
                slot={slot}
                saloes={saloes}
                onClick={() => onClickSlot(slot)}
              />
            ))}
          </div>
        )}
      </div>

        {/* Botão + azul pra adicionar nova janela nesse dia */}
        {podeConfig && (
          <button
            type="button"
            onClick={onClickAdicionarExtra}
            className="w-full px-2 py-1.5 rounded-md border border-dashed border-sky-300 dark:border-sky-900 text-sky-700 dark:text-sky-300 bg-sky-50/50 dark:bg-sky-900/10 hover:bg-sky-100 dark:hover:bg-sky-900/30 transition-colors text-[11px] font-medium flex items-center justify-center gap-1"
            title="Adicionar janela extra nesse dia"
          >
            <span className="text-sm leading-none">+</span>
            <span>nova janela</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Chip de um slot ──────────────────────────────────────────────────

// Altura fixa do chip — padroniza o visual da agenda independente do
// número de salões. Comporta horário + até 2 linhas de salão + 1 de
// override de pax (se houver).
const CHIP_HEIGHT = "h-[86px]";

function SlotChip({
  slot, saloes, onClick,
}: {
  slot: SlotResolvido;
  saloes: Salao[];
  onClick: () => void;
}) {
  const cor = COR_STATUS_SLOT[slot.status];

  // Resolve salões com pax — base (capacidade do salão). Quando há
  // paxMaxOverride no slot, é um teto pro slot inteiro (não distribuído
  // por salão) — exibido em linha separada abaixo.
  const saloesInfo = slot.salaoIds
    .map(id => {
      const s = saloes.find(sa => sa.id === id);
      if (!s) return null;
      return { nome: s.nome, pax: paxDoSalao(s) };
    })
    .filter((x): x is { nome: string; pax: number } => !!x);

  const saloesNomeCompleto = saloesInfo.map(s => `${s.nome} · ${s.pax}p`).join(" + ") || "—";

  // Limita a 2 salões visíveis; resto vira "+N"
  const VISIBLE = 2;
  const visiveis = saloesInfo.slice(0, VISIBLE);
  const restante = saloesInfo.length - VISIBLE;

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${slot.horario} · ${saloesNomeCompleto}${slot.motivos[0] ? " · " + slot.motivos[0] : ""}`}
      className={`w-full ${CHIP_HEIGHT} text-left px-2 py-1.5 rounded-md border ${cor.border} ${cor.bg} hover:brightness-95 dark:hover:brightness-110 transition-all cursor-pointer flex flex-col`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className={`text-sm font-semibold tabular-nums ${cor.text}`}>
          {slot.horario}
        </span>
        {slot.status !== "normal" && (
          <span className={`text-[9px] font-bold uppercase ${cor.text} opacity-80`}>
            {slot.status === "bloqueado" ? "✕" : slot.status === "personalizado" ? "✎" : "✦"}
          </span>
        )}
      </div>

      {/* Lista de salões + pax — 1 linha por salão, até 2 visíveis */}
      <div className="flex-1 mt-0.5 flex flex-col justify-start min-h-0">
        {visiveis.map(s => (
          <div key={s.nome} className={`text-[10px] ${cor.text} opacity-90 leading-tight truncate flex items-baseline gap-1`}>
            <span className="truncate">{s.nome}</span>
            <span className="tabular-nums opacity-75 ml-auto flex-shrink-0">{s.pax}p</span>
          </div>
        ))}
        {restante > 0 && (
          <div className={`text-[9px] ${cor.text} opacity-60 italic`}>
            +{restante} salão{restante !== 1 ? "ões" : ""}
          </div>
        )}
        {slot.paxMaxOverride != null && (
          <div className={`text-[9px] ${cor.text} opacity-75 italic mt-auto`}>
            ≤{slot.paxMaxOverride} pax total
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Legenda ─────────────────────────────────────────────────────────

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
