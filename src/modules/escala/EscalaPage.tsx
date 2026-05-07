import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfig, canUse } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import {
  daysInMonth, dowShort, fmtAnoMes, nomeMes, pad2, shiftMonth,
} from "../../core/utils/date";
import type { Cargo, Empregado, EscalaMes, ScheduleStatus } from "../../core/types";
import { derivedScheduleForEmpregado, type DerivedDay } from "../../core/escala/horarios";

// Tabela de status: cor + label curto + label longo
const STATUS_INFO: Record<ScheduleStatus, { label: string; short: string; bg: string; text: string }> = {
  trabalho:  { label: "Trabalho",                short: "T",  bg: "bg-emerald-500",  text: "text-white" },
  folga:     { label: "Folga",                   short: "F",  bg: "bg-gray-300 dark:bg-gray-700",  text: "text-gray-700 dark:text-gray-200" },
  freela:    { label: "Freela",                  short: "FR", bg: "bg-purple-500",   text: "text-white" },
  comp:      { label: "Compensação (folgou)",    short: "C",  bg: "bg-amber-400",    text: "text-amber-950" },
  comp_trab: { label: "Comp. trabalhado",        short: "CT", bg: "bg-amber-600",    text: "text-white" },
  ferias:    { label: "Férias",                  short: "FE", bg: "bg-sky-500",      text: "text-white" },
  falta_j:   { label: "Falta justificada",       short: "FJ", bg: "bg-rose-300",     text: "text-rose-900" },
  falta_i:   { label: "Falta injustificada",     short: "FI", bg: "bg-rose-600",     text: "text-white" },
};

const STATUS_LIST: ScheduleStatus[] = [
  "trabalho", "folga", "freela", "comp", "comp_trab", "ferias", "falta_j", "falta_i",
];

export function EscalaPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find(r => r.id === rid) || null;
  const podeUsar = canUse(me, rid, "escala");
  const podeConfig = canConfig(me, rid, "escala");

  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);

  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [escala, setEscala] = useState<EscalaMes | null>(null);
  const [loading, setLoading] = useState(true);
  // Versão da escala em edição: prevista (planejamento) ou real (após o mês)
  const [versao, setVersao] = useState<"prevista" | "real">("prevista");

  // Quando carrega a escala: se VT já foi pago, abre direto na real
  useEffect(() => {
    if (escala?.vtPagoEm) setVersao("real");
  }, [escala?.vtPagoEm]);

  // Empregados
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "empregados"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado);
      setEmpregados(list);
    });
    return () => unsub();
  }, [rid]);

  // Cargos
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "cargos"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo);
      setCargos(list);
    });
    return () => unsub();
  }, [rid]);

  // Escala do mês
  const escalaId = `${rid}_${fmtAnoMes(ano, mes)}`;
  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    const ref = doc(db, "escalas", escalaId);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setEscala({ id: snap.id, ...snap.data() } as EscalaMes);
      } else {
        setEscala(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [rid, escalaId]);

  // Filtra empregados que estiveram ATIVOS em algum dia do mês
  // (algum dos periodos cobre alguma data do intervalo)
  const empregadosDoMes = useMemo(() => {
    const inicioMes = `${ano}-${pad2(mes)}-01`;
    const fimMes    = `${ano}-${pad2(mes)}-${pad2(daysInMonth(ano, mes))}`;
    return empregados.filter(e => {
      for (const p of e.periodos || []) {
        if (p.admissao > fimMes) continue;            // admitido depois do fim do mês
        if (p.demissao && p.demissao <= inicioMes) continue; // demitido antes/no 1º dia
        return true;
      }
      return false;
    });
  }, [empregados, ano, mes]);

  // Calcula a escala derivada (dos workSchedules) pra cada empregado do mês
  const derivados = useMemo(() => {
    const m: Record<string, { [date: string]: DerivedDay }> = {};
    for (const e of empregadosDoMes) {
      m[e.id] = derivedScheduleForEmpregado(e, ano, mes);
    }
    return m;
  }, [empregadosDoMes, ano, mes]);

  // Ordena por área do cargo + nome
  const empregadosOrdenados = useMemo(() => {
    const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));
    const areaOrder: Record<string, number> = { "Salão": 0, Bar: 1, Cozinha: 2, Limpeza: 3 };
    return [...empregadosDoMes].sort((a, b) => {
      const ca = cargoMap[a.cargoId];
      const cb = cargoMap[b.cargoId];
      const ao = ca ? areaOrder[ca.area] ?? 99 : 99;
      const bo = cb ? areaOrder[cb.area] ?? 99 : 99;
      if (ao !== bo) return ao - bo;
      const an = ca?.nome || "";
      const bn = cb?.nome || "";
      if (an !== bn) return an.localeCompare(bn);
      return a.nome.localeCompare(b.nome);
    });
  }, [empregadosDoMes, cargos]);

  const dias = daysInMonth(ano, mes);

  async function setStatusCelula(empregadoId: string, ymdDate: string, status: ScheduleStatus | null) {
    if (!rid) return;
    const fonte = versao === "prevista" ? escala?.prevista : escala?.real;
    const novo = { ...(fonte || {}) };
    const dias = { ...(novo[empregadoId] || {}) };
    if (status === null) {
      delete dias[ymdDate];
    } else {
      dias[ymdDate] = status;
    }
    novo[empregadoId] = dias;

    const patch: Partial<EscalaMes> & Pick<EscalaMes, "id" | "restaurantId" | "ano" | "mes" | "updatedAt"> = {
      id: escalaId,
      restaurantId: rid,
      ano,
      mes,
      prevista: versao === "prevista" ? novo : (escala?.prevista || {}),
      real:     versao === "real"     ? novo : (escala?.real || {}),
      updatedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, "escalas", escalaId), patch, { merge: true });
  }

  // Copia o que tem na prevista pra real (útil pra começar o mês a partir do plano)
  async function copiarPrevistaParaReal() {
    if (!rid || !escala?.prevista) return;
    if (!confirm("Copiar a Prevista pra Real? (sobrescreve o que estiver na Real)")) return;
    await setDoc(doc(db, "escalas", escalaId), {
      id: escalaId,
      restaurantId: rid,
      ano, mes,
      real: { ...escala.prevista },
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    setVersao("real");
  }

  function navegarMes(delta: number) {
    const next = shiftMonth(ano, mes, delta);
    setAno(next.ano);
    setMes(next.mes);
  }

  if (!activeRestaurant) {
    return <div className="text-gray-500">Selecione um restaurante.</div>;
  }
  if (!podeUsar) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  const fechada = !!escala?.fechadoEm;
  const vtPago = !!escala?.vtPagoEm;
  // Pode editar a versão atualmente selecionada?
  // - Mês fechado → nada editável
  // - Prevista após VT pago → trava (snapshot pra cálculo)
  // - Real até o fechamento → editável
  const podeEditar = podeConfig && !fechada && !(versao === "prevista" && vtPago);
  const realVazia = !escala?.real || Object.keys(escala.real).length === 0;

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">📅 Escala</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{activeRestaurant.nome}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={() => navegarMes(-1)}>←</Button>
          <div className="px-4 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 font-medium text-sm min-w-[160px] text-center">
            {nomeMes(mes)} {ano}
          </div>
          <Button variant="secondary" size="sm" onClick={() => navegarMes(1)}>→</Button>
        </div>
      </div>

      {/* Toggle Prevista / Real + status */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="inline-flex items-center bg-gray-100 dark:bg-gray-800/60 p-0.5 rounded-lg">
          <button
            type="button"
            onClick={() => setVersao("prevista")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              versao === "prevista"
                ? "bg-white dark:bg-gray-900 shadow-sm text-gray-900 dark:text-gray-100"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900"
            }`}
          >
            📋 Prevista
            {vtPago && versao !== "prevista" && <span className="ml-1 text-[10px]">🔒</span>}
          </button>
          <button
            type="button"
            onClick={() => setVersao("real")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              versao === "real"
                ? "bg-white dark:bg-gray-900 shadow-sm text-gray-900 dark:text-gray-100"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900"
            }`}
          >
            ✅ Real
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {versao === "real" && realVazia && podeConfig && !fechada && (
            <Button variant="secondary" size="sm" onClick={copiarPrevistaParaReal}>
              📋 Copiar Prevista → Real
            </Button>
          )}
          {fechada && (
            <span className="text-xs font-bold uppercase tracking-wider px-2 py-1 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
              🔒 Fechada
            </span>
          )}
          {!fechada && vtPago && (
            <span className="text-xs font-bold uppercase tracking-wider px-2 py-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              💸 VT pago
            </span>
          )}
        </div>
      </div>

      {/* Banners de status */}
      <BannerStatus versao={versao} vtPago={vtPago} fechada={fechada} />

      <Legenda />

      {loading ? (
        <div className="text-sm text-gray-500 mt-6">Carregando...</div>
      ) : empregadosOrdenados.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center mt-6">
          <div className="text-4xl mb-3">🤷</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhum empregado neste mês</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Cadastre empregados em Pessoas (filtro "Empregados") pra começar a montar a escala.
          </p>
        </div>
      ) : (
        <Grade
          ano={ano}
          mes={mes}
          dias={dias}
          empregados={empregadosOrdenados}
          cargos={cargos}
          escala={escala}
          derivados={derivados}
          versao={versao}
          podeEditar={podeEditar}
          onSetStatus={setStatusCelula}
        />
      )}
    </div>
  );
}

function BannerStatus({
  versao, vtPago, fechada,
}: { versao: "prevista" | "real"; vtPago: boolean; fechada: boolean }) {
  if (fechada) {
    return (
      <div className="rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3 text-sm text-rose-800 dark:text-rose-300 mb-4">
        🔒 Mês fechado. Tudo read-only — gorjetas e VT consolidados.
      </div>
    );
  }
  if (versao === "prevista" && vtPago) {
    return (
      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-300 mb-4">
        💸 VT já foi pago. A Prevista ficou travada como snapshot pro cálculo.
        Pra registrar o que de fato aconteceu (faltas, atestados, mudanças), edite a <strong>Real</strong>.
      </div>
    );
  }
  if (versao === "prevista") {
    return (
      <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-3 text-sm text-emerald-800 dark:text-emerald-300 mb-4">
        📋 <strong>Prevista</strong> = planejamento. Edite aqui antes de pagar o VT.
        Quando pagar VT, esta versão fica congelada como snapshot pro cálculo.
      </div>
    );
  }
  // versao === "real"
  return (
    <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 text-sm text-blue-800 dark:text-blue-300 mb-4">
      ✅ <strong>Real</strong> = o que de fato aconteceu. Use pra calcular gorjetas
      e detectar divergências de VT (a devolver / a receber).
    </div>
  );
}

function Legenda() {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {STATUS_LIST.map(s => (
        <div key={s} className="flex items-center gap-1.5 text-xs">
          <span className={`inline-flex items-center justify-center w-6 h-6 rounded ${STATUS_INFO[s].bg} ${STATUS_INFO[s].text} font-bold`}>
            {STATUS_INFO[s].short}
          </span>
          <span className="text-gray-600 dark:text-gray-400">{STATUS_INFO[s].label}</span>
        </div>
      ))}
    </div>
  );
}

function Grade({
  ano, mes, dias, empregados, cargos, escala, derivados, versao, podeEditar, onSetStatus,
}: {
  ano: number; mes: number; dias: number;
  empregados: Empregado[]; cargos: Cargo[]; escala: EscalaMes | null;
  derivados: Record<string, { [date: string]: DerivedDay }>;
  versao: "prevista" | "real";
  podeEditar: boolean;
  onSetStatus: (empregadoId: string, ymd: string, status: ScheduleStatus | null) => void;
}) {
  const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));
  const [openCell, setOpenCell] = useState<{ emp: string; ymd: string } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Fecha popover ao clicar fora
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpenCell(null);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const hojeYmd = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  })();

  return (
    <div ref={wrapRef} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead className="bg-gray-50 dark:bg-gray-800/50 sticky top-0 z-10">
          <tr>
            <th className="text-left px-3 py-2 font-semibold text-gray-700 dark:text-gray-300 sticky left-0 bg-gray-50 dark:bg-gray-800/50 z-20 min-w-[200px]">
              Empregado
            </th>
            {Array.from({ length: dias }, (_, i) => i + 1).map(dia => {
              const d = new Date(ano, mes - 1, dia);
              const wd = d.getDay();
              const weekend = wd === 0 || wd === 6;
              return (
                <th
                  key={dia}
                  className={`px-1 py-1 text-center font-semibold ${weekend ? "bg-amber-50 dark:bg-amber-900/20" : ""}`}
                >
                  <div className="text-gray-700 dark:text-gray-300">{dia}</div>
                  <div className="text-[10px] text-gray-400 uppercase">{dowShort(d)}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {empregados.map(e => {
            const cargo = cargoMap[e.cargoId];
            const dot = cargo?.area === "Salão" ? "bg-emerald-500"
                      : cargo?.area === "Bar"    ? "bg-blue-500"
                      : cargo?.area === "Cozinha" ? "bg-orange-500"
                      : "bg-gray-400";
            return (
              <tr key={e.id} className="border-t border-gray-100 dark:border-gray-800">
                <td className="px-3 py-1.5 sticky left-0 bg-white dark:bg-gray-900 z-10 border-r border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
                    <div>
                      <div className="font-medium text-gray-900 dark:text-gray-100">{e.nome}</div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400">{cargo?.nome || "—"}</div>
                    </div>
                  </div>
                </td>
                {Array.from({ length: dias }, (_, i) => i + 1).map(dia => {
                  const d = `${ano}-${pad2(mes)}-${pad2(dia)}`;
                  const override = escala?.[versao]?.[e.id]?.[d];
                  const derived = derivados[e.id]?.[d];
                  const isToday = d === hojeYmd;
                  const isOpen = openCell?.emp === e.id && openCell?.ymd === d;
                  return (
                    <td key={dia} className={`p-0.5 text-center relative ${isToday ? "ring-1 ring-indigo-400 ring-inset" : ""}`}>
                      <Celula
                        override={override}
                        derived={derived}
                        podeEditar={podeEditar}
                        isOpen={isOpen}
                        onClick={() => setOpenCell(isOpen ? null : { emp: e.id, ymd: d })}
                      />
                      {isOpen && podeEditar && (
                        <CellMenu
                          override={override || null}
                          derived={derived || null}
                          onPick={(s) => { onSetStatus(e.id, d, s); setOpenCell(null); }}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Renderiza UMA célula da grade combinando override + derivado.
// - Override (manual): cor sólida, foco visual.
// - Derivado vindo do horário cadastrado: cor light + borda tracejada.
// - Sem nada (sem horário cadastrado): célula vazia (subentende "trabalho implícito").
function Celula({
  override, derived, podeEditar, isOpen, onClick,
}: {
  override: ScheduleStatus | undefined;
  derived: DerivedDay | undefined;
  podeEditar: boolean;
  isOpen: boolean;
  onClick: () => void;
}) {
  // Resolve display
  const displayStatus = override ?? derived?.status;
  const isFromOverride = !!override;
  const isImplicito = !override && derived?.fonte === "implicito";

  // Trabalho derivado de horário cadastrado: mostra com cor light (T cinza-esverdeado tracejado)
  // Trabalho implícito (sem cadastro): mostra como célula vazia, hint
  if (!displayStatus || (isImplicito)) {
    return (
      <button
        type="button"
        disabled={!podeEditar}
        onClick={onClick}
        className={`w-7 h-7 rounded text-[10px] font-bold transition-all bg-gray-100 dark:bg-gray-800/40 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 ${
          podeEditar ? "cursor-pointer hover:scale-110" : "cursor-default"
        } ${isOpen ? "ring-1 ring-indigo-400" : ""}`}
        title={isImplicito ? "Sem horário cadastrado — assume trabalho" : "Vazio"}
      >
        {isImplicito ? "·" : ""}
      </button>
    );
  }

  const info = STATUS_INFO[displayStatus];
  if (isFromOverride) {
    // Override = cor sólida + sem borda especial
    return (
      <button
        type="button"
        disabled={!podeEditar}
        onClick={onClick}
        className={`w-7 h-7 rounded text-[10px] font-bold transition-all ${info.bg} ${info.text} ${
          podeEditar ? "cursor-pointer hover:scale-110" : "cursor-default"
        } ${isOpen ? "ring-1 ring-indigo-400" : ""}`}
        title={`${info.label} (override manual)`}
      >
        {info.short}
      </button>
    );
  }

  // Derivado de horário cadastrado: cor light + borda tracejada
  return (
    <button
      type="button"
      disabled={!podeEditar}
      onClick={onClick}
      className={`w-7 h-7 rounded text-[10px] font-bold transition-all border border-dashed border-gray-300 dark:border-gray-600 ${info.bg} ${info.text} opacity-50 ${
        podeEditar ? "cursor-pointer hover:opacity-80 hover:scale-110" : "cursor-default"
      } ${isOpen ? "ring-1 ring-indigo-400 opacity-100" : ""}`}
      title={`${info.label} (do horário cadastrado)`}
    >
      {info.short}
    </button>
  );
}

function CellMenu({
  override, derived, onPick,
}: {
  override: ScheduleStatus | null;
  derived: DerivedDay | null;
  onPick: (s: ScheduleStatus | null) => void;
}) {
  const displayAtual = override ?? derived?.status ?? null;
  return (
    <div className="absolute z-30 top-full left-1/2 -translate-x-1/2 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-1 min-w-[200px]">
      {derived && derived.fonte === "schedule" && (
        <div className="text-[10px] text-gray-500 dark:text-gray-400 px-2 py-1 border-b border-gray-100 dark:border-gray-800 mb-1">
          📋 Horário cadastrado: <strong>{STATUS_INFO[derived.status].label}</strong>
        </div>
      )}
      {STATUS_LIST.map(s => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-800 ${displayAtual === s ? "ring-1 ring-indigo-400" : ""}`}
        >
          <span className={`inline-flex items-center justify-center w-5 h-5 rounded ${STATUS_INFO[s].bg} ${STATUS_INFO[s].text} text-[10px] font-bold`}>
            {STATUS_INFO[s].short}
          </span>
          <span className="text-gray-700 dark:text-gray-300">{STATUS_INFO[s].label}</span>
        </button>
      ))}
      {override && (
        <button
          type="button"
          onClick={() => onPick(null)}
          className="w-full px-2 py-1.5 rounded text-left text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 mt-1 border-t border-gray-100 dark:border-gray-800 pt-2"
        >
          {derived?.fonte === "schedule"
            ? `↩ Reverter ao cadastrado (${STATUS_INFO[derived.status].label})`
            : "🗑 Limpar override"}
        </button>
      )}
    </div>
  );
}
