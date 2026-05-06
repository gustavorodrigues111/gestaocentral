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

  // Fase 0: editamos a versão PREVISTA. Fase 7 vai dividir a UI em prevista/real.
  async function setStatusCelula(empregadoId: string, ymdDate: string, status: ScheduleStatus | null) {
    if (!rid) return;
    const previstaNova = { ...(escala?.prevista || {}) };
    const dias = { ...(previstaNova[empregadoId] || {}) };
    if (status === null) {
      delete dias[ymdDate];
    } else {
      dias[ymdDate] = status;
    }
    previstaNova[empregadoId] = dias;

    const payload: EscalaMes = {
      id: escalaId,
      restaurantId: rid,
      ano,
      mes,
      prevista: previstaNova,
      real: escala?.real || {},
      vtPagoEm: escala?.vtPagoEm ?? null,
      vtPagoPor: escala?.vtPagoPor ?? null,
      fechadoEm: escala?.fechadoEm ?? null,
      fechadoPor: escala?.fechadoPor ?? null,
      updatedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, "escalas", escalaId), payload, { merge: true });
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
  const podeEditar = podeConfig && !fechada;

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">📅 Escala</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{activeRestaurant.nome}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => navegarMes(-1)}>←</Button>
          <div className="px-4 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 font-medium text-sm min-w-[160px] text-center">
            {nomeMes(mes)} {ano}
          </div>
          <Button variant="secondary" size="sm" onClick={() => navegarMes(1)}>→</Button>
          {fechada && (
            <span className="ml-2 text-xs font-bold uppercase tracking-wider px-2 py-1 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
              Fechada
            </span>
          )}
        </div>
      </div>

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
          podeEditar={podeEditar}
          onSetStatus={setStatusCelula}
        />
      )}
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
  ano, mes, dias, empregados, cargos, escala, podeEditar, onSetStatus,
}: {
  ano: number; mes: number; dias: number;
  empregados: Empregado[]; cargos: Cargo[]; escala: EscalaMes | null;
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
                  const status = escala?.prevista?.[e.id]?.[d];
                  const isToday = d === hojeYmd;
                  const isOpen = openCell?.emp === e.id && openCell?.ymd === d;
                  return (
                    <td key={dia} className={`p-0.5 text-center relative ${isToday ? "ring-1 ring-indigo-400 ring-inset" : ""}`}>
                      <button
                        type="button"
                        disabled={!podeEditar}
                        onClick={() => setOpenCell(isOpen ? null : { emp: e.id, ymd: d })}
                        className={`w-7 h-7 rounded text-[10px] font-bold transition-all ${
                          status
                            ? `${STATUS_INFO[status].bg} ${STATUS_INFO[status].text}`
                            : "bg-gray-100 dark:bg-gray-800/40 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                        } ${podeEditar ? "cursor-pointer hover:scale-110" : "cursor-default"}`}
                        title={status ? STATUS_INFO[status].label : "Vazio"}
                      >
                        {status ? STATUS_INFO[status].short : ""}
                      </button>
                      {isOpen && podeEditar && (
                        <CellMenu
                          atual={status || null}
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

function CellMenu({ atual, onPick }: { atual: ScheduleStatus | null; onPick: (s: ScheduleStatus | null) => void }) {
  return (
    <div className="absolute z-30 top-full left-1/2 -translate-x-1/2 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-1 min-w-[170px]">
      {STATUS_LIST.map(s => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-800 ${atual === s ? "ring-1 ring-indigo-400" : ""}`}
        >
          <span className={`inline-flex items-center justify-center w-5 h-5 rounded ${STATUS_INFO[s].bg} ${STATUS_INFO[s].text} text-[10px] font-bold`}>
            {STATUS_INFO[s].short}
          </span>
          <span className="text-gray-700 dark:text-gray-300">{STATUS_INFO[s].label}</span>
        </button>
      ))}
      {atual && (
        <button
          type="button"
          onClick={() => onPick(null)}
          className="w-full px-2 py-1.5 rounded text-left text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 mt-1 border-t border-gray-100 dark:border-gray-800 pt-2"
        >
          🗑 Limpar
        </button>
      )}
    </div>
  );
}
