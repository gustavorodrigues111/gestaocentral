import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfigurar, canVer } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { EVENTO_TRILHA_ICON, EVENTO_TRILHA_LABEL } from "../../core/types";
import type { Cargo, Empregado, EventoTrilha, EventoTrilhaTipo } from "../../core/types";
import { EventoTrilhaModal } from "./EventoTrilhaModal";
import { anularEvento, registrarVisualizacao } from "./repository";

const TIPOS_FILTRO: ("todos" | EventoTrilhaTipo)[] = [
  "todos",
  "admissao", "demissao", "readmissao",
  "mudanca_cargo", "promocao", "promocao_salarial",
  "treinamento", "feedback_positivo", "feedback_negativo",
  "ocorrencia", "premiacao", "advertencia",
  "ferias", "exame_realizado", "reuniao_individual", "entrega_uniforme",
  "ponto_atraso", "ponto_falta_j", "ponto_falta_i", "ponto_compensacao",
  "outro",
];

export function TrilhaPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find(r => r.id === rid) || null;
  const podeVer = canVer(me, rid, "trilha");
  const podeConfig = canConfigurar(me, rid, "trilha");

  const [eventos, setEventos] = useState<EventoTrilha[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [filtroEmp, setFiltroEmp] = useState<string>("");
  const [filtroTipo, setFiltroTipo] = useState<"todos" | EventoTrilhaTipo>("todos");
  const [editing, setEditing] = useState<{ empregadoId: string; evento: EventoTrilha | null } | null>(null);

  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    const q = query(collection(db, "eventosTrilha"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as EventoTrilha);
      list.sort((a, b) => (b.data || "").localeCompare(a.data || ""));
      setEventos(list);
      setLoading(false);
    });
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "empregados"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado));
    });
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "cargos"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setCargos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo));
    });
    return () => unsub();
  }, [rid]);

  const empMap = useMemo(() => Object.fromEntries(empregados.map(e => [e.id, e])), [empregados]);
  const cargoMap = useMemo(() => Object.fromEntries(cargos.map(c => [c.id, c])), [cargos]);

  // Empregados ordenados (área + nome)
  const empregadosOrdenados = useMemo(() => {
    return [...empregados].sort((a, b) => {
      const ca = cargoMap[a.cargoId];
      const cb = cargoMap[b.cargoId];
      const areaA = ca?.area || "ZZ";
      const areaB = cb?.area || "ZZ";
      if (areaA !== areaB) return areaA.localeCompare(areaB);
      return a.nome.localeCompare(b.nome);
    });
  }, [empregados, cargoMap]);

  const filtered = useMemo(() => {
    return eventos.filter(e => {
      if (filtroEmp && e.empregadoId !== filtroEmp) return false;
      if (filtroTipo !== "todos" && e.tipo !== filtroTipo) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        const empNome = empMap[e.empregadoId]?.nome.toLowerCase() || "";
        if (
          !e.titulo.toLowerCase().includes(s) &&
          !(e.descricao || "").toLowerCase().includes(s) &&
          !empNome.includes(s)
        ) return false;
      }
      return true;
    });
  }, [eventos, filtroEmp, filtroTipo, search, empMap]);

  async function anular(e: EventoTrilha) {
    if (!me) return;
    const motivo = prompt(
      "Anular evento da trilha.\n\n" +
      "Eventos da trilha NÃO podem ser deletados (LGPD/auditoria). " +
      "Eles ficam marcados como anulados com motivo e autor registrados.\n\n" +
      "Motivo da anulação:"
    );
    if (!motivo || !motivo.trim()) return;
    try {
      await anularEvento(e.id, motivo.trim(), { id: me.id, nome: me.nome });
    } catch (err) {
      alert("Falha ao anular: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  // Log LGPD: registra que a trilha foi visualizada (lista ou empregado específico)
  useEffect(() => {
    if (!rid || !me || !podeVer) return;
    registrarVisualizacao({
      restaurantId: rid,
      empregadoId: filtroEmp || "*todos*",
      visualizadoPor: me.id,
      visualizadoPorNome: me.nome,
      contexto: filtroEmp ? "empregado" : "lista",
    }).catch(err => console.warn("[trilha] falha ao registrar visualização:", err));
  }, [rid, me, podeVer, filtroEmp]);

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  // Stats: total por tipo
  const stats = eventos.reduce<Record<string, number>>((acc, e) => {
    acc[e.tipo] = (acc[e.tipo] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-5xl">
      {/* Aviso permanente: dados sensíveis (LGPD) */}
      <div className="mb-4 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
        <span className="text-base leading-none">🔒</span>
        <div>
          <strong>Dados sensíveis — uso restrito.</strong> A trilha registra histórico completo do empregado (admissões, demissões, advertências, exames, ferias, ponto e remuneração). Visualizações são auditadas (LGPD). Eventos não podem ser deletados — apenas anulados com motivo.
        </div>
      </div>

      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">🎯 Trilha do Empregado</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{restaurant.nome}</p>
        </div>
        {podeConfig && (
          <Button onClick={() => {
            const empId = filtroEmp || (empregadosOrdenados.find(e => e.estaAtivo)?.id || "");
            if (!empId) { alert("Cadastre um empregado primeiro."); return; }
            setEditing({ empregadoId: empId, evento: null });
          }}>+ Novo evento</Button>
        )}
      </div>

      {/* Filtros */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Input
          placeholder="🔍 Buscar..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          value={filtroEmp}
          onChange={(e) => setFiltroEmp(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        >
          <option value="">Todos os empregados</option>
          {empregadosOrdenados.map(e => (
            <option key={e.id} value={e.id}>
              {e.nome} ({cargoMap[e.cargoId]?.area || "?"})
              {!e.estaAtivo ? " — inativo" : ""}
            </option>
          ))}
        </select>
        <select
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value as "todos" | EventoTrilhaTipo)}
          className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        >
          {TIPOS_FILTRO.map(t => (
            <option key={t} value={t}>
              {t === "todos" ? "Todos os tipos" : `${EVENTO_TRILHA_ICON[t]} ${EVENTO_TRILHA_LABEL[t]}`}
            </option>
          ))}
        </select>
      </div>

      {/* Stats compactas */}
      {!loading && eventos.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-4 text-xs">
          {Object.entries(stats)
            .sort(([, a], [, b]) => b - a)
            .map(([tipo, n]) => (
              <button
                key={tipo}
                onClick={() => setFiltroTipo(tipo as EventoTrilhaTipo)}
                className={`px-2 py-1 rounded-full transition-colors ${
                  filtroTipo === tipo
                    ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200"
                }`}
              >
                {EVENTO_TRILHA_ICON[tipo as EventoTrilhaTipo]} {EVENTO_TRILHA_LABEL[tipo as EventoTrilhaTipo]} ({n})
              </button>
            ))}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">🎯</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            {search || filtroEmp || filtroTipo !== "todos"
              ? "Nenhum evento bate nos filtros"
              : "Nenhum evento de trilha"}
          </p>
          {!search && !filtroEmp && filtroTipo === "todos" && (
            <p className="text-sm text-gray-500 mt-2">
              Eventos são criados manualmente ou automaticamente quando você admite/demite/muda cargo de um empregado.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(e => {
            const emp = empMap[e.empregadoId];
            const cargoAtual = emp ? cargoMap[emp.cargoId] : null;
            const anulado = !!e.anulado;
            return (
              <div
                key={e.id}
                className={`border rounded-xl p-4 ${
                  anulado
                    ? "bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-800 opacity-70"
                    : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800"
                }`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-start gap-3 flex-1">
                    <span className={`text-2xl ${anulado ? "grayscale" : ""}`}>{EVENTO_TRILHA_ICON[e.tipo]}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className={`font-bold ${anulado ? "line-through text-gray-500 dark:text-gray-500" : "text-gray-900 dark:text-gray-100"}`}>{e.titulo}</h3>
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                          {EVENTO_TRILHA_LABEL[e.tipo]}
                        </span>
                        {e.fonte === "auto" && (
                          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                            🤖 Auto
                          </span>
                        )}
                        {anulado && (
                          <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                            ⚠ Anulado
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                        👤 {emp?.nome || e.empregadoNomeSnapshot || "(empregado removido)"}
                        {cargoAtual && <> · {cargoAtual.nome} ({cargoAtual.area})</>}
                        <> · 📅 {new Date(e.data + "T12:00:00").toLocaleDateString("pt-BR")}</>
                      </div>
                      {e.descricao && (
                        <p className={`text-sm mt-1 whitespace-pre-wrap ${anulado ? "text-gray-500 dark:text-gray-500" : "text-gray-700 dark:text-gray-300"}`}>{e.descricao}</p>
                      )}
                      {e.anexoUrl && !anulado && (
                        <a
                          href={e.anexoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline mt-1"
                        >
                          📎 {e.anexoNome || "Anexo"}
                        </a>
                      )}
                      {anulado && (
                        <div className="mt-2 text-[11px] text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-2 py-1">
                          <strong>Anulado</strong>
                          {e.anuladoEm && <> em {new Date(e.anuladoEm).toLocaleString("pt-BR")}</>}
                          {e.anuladoPorNome && <> por {e.anuladoPorNome}</>}
                          {e.motivoAnulacao && (
                            <div className="mt-0.5">Motivo: {e.motivoAnulacao}</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {podeConfig && !anulado && (
                    <div className="flex gap-1">
                      {e.fonte === "manual" && (
                        <Button variant="secondary" size="sm" onClick={() => setEditing({ empregadoId: e.empregadoId, evento: e })}>Editar</Button>
                      )}
                      <Button variant="danger" size="sm" onClick={() => anular(e)}>Anular</Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <EventoTrilhaModal
          empregadoId={editing.empregadoId}
          empregados={empregadosOrdenados}
          cargoMap={cargoMap}
          evento={editing.evento}
          restaurantId={rid}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
