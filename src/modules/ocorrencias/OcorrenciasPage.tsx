import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { todayYmd } from "../../core/utils/date";
import {
  OCORRENCIA_GRAVIDADE_ICON, OCORRENCIA_GRAVIDADE_LABEL,
  OCORRENCIA_STATUS_LABEL,
} from "../../core/types";
import type { Cargo, Empregado, Ocorrencia, OcorrenciaGravidade, OcorrenciaStatus } from "../../core/types";
import { OcorrenciaModal } from "./OcorrenciaModal";

const GRAVIDADE_CLS: Record<OcorrenciaGravidade, string> = {
  elogio: "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800",
  leve:   "border-blue-300 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800",
  media:  "border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800",
  grave:  "border-rose-300 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800",
};

const STATUS_CLS: Record<OcorrenciaStatus, string> = {
  aberta:       "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  em_apuracao:  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  resolvida:    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  arquivada:    "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

export function OcorrenciasPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find(r => r.id === rid) || null;

  // Granular: cada ação é independente.
  //   criar     → vê o botão "+ Nova ocorrência"
  //   ver       → vê a lista de ocorrências registradas
  //   editar    → pode mudar status (apurar/resolver/arquivar/reabrir), editar e excluir
  //   estatistics → vê os cards de estatísticas no topo
  // Acesso à página exige criar OU ver (qualquer um basta).
  const isMaster = !!me?.isMaster;
  const { can, loading: loadingPerfis } = useCanAcao(rid);
  const podeCriar     = isMaster || can("ocorrencias", "criar");
  const podeVer       = isMaster || can("ocorrencias", "ver");
  const podeEditar    = isMaster || can("ocorrencias", "editar");
  const podeStats     = isMaster || can("ocorrencias", "estatistics");

  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [filtroGrav, setFiltroGrav] = useState<"todas" | OcorrenciaGravidade>("todas");
  const [filtroStatus, setFiltroStatus] = useState<"abertas" | "todas" | OcorrenciaStatus>("abertas");
  const [editing, setEditing] = useState<Ocorrencia | "new" | null>(null);

  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    const q = query(collection(db, "ocorrencias"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Ocorrencia);
      list.sort((a, b) => {
        const ad = `${a.data} ${a.hora || "00:00"}`;
        const bd = `${b.data} ${b.hora || "00:00"}`;
        return bd.localeCompare(ad);
      });
      setOcorrencias(list);
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

  const filtered = useMemo(() => {
    return ocorrencias.filter(o => {
      if (filtroGrav !== "todas" && o.gravidade !== filtroGrav) return false;
      if (filtroStatus === "abertas") {
        if (o.status === "resolvida" || o.status === "arquivada") return false;
      } else if (filtroStatus !== "todas" && o.status !== filtroStatus) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        const empNomes = o.empregadosEnvolvidos.map(id => empMap[id]?.nome.toLowerCase() || "").join(" ");
        if (
          !o.titulo.toLowerCase().includes(s) &&
          !o.descricao.toLowerCase().includes(s) &&
          !(o.clienteNome || "").toLowerCase().includes(s) &&
          !empNomes.includes(s)
        ) return false;
      }
      return true;
    });
  }, [ocorrencias, filtroGrav, filtroStatus, search, empMap]);

  // Stats topo
  const today = todayYmd();
  const hoje = ocorrencias.filter(o => o.data === today).length;
  const abertas = ocorrencias.filter(o => o.status === "aberta" || o.status === "em_apuracao").length;
  const graves7d = useMemo(() => {
    const setemDias = new Date();
    setemDias.setDate(setemDias.getDate() - 7);
    const limite = setemDias.toISOString().slice(0, 10);
    return ocorrencias.filter(o => o.gravidade === "grave" && o.data >= limite).length;
  }, [ocorrencias]);

  async function excluir(o: Ocorrencia) {
    if (!confirm(`Excluir "${o.titulo}"?`)) return;
    await deleteDoc(doc(db, "ocorrencias", o.id));
  }

  async function setStatus(o: Ocorrencia, status: OcorrenciaStatus) {
    if (!me) return;
    const patch: Partial<Ocorrencia> = {
      status,
      atualizadaEm: new Date().toISOString(),
    };
    if (status === "resolvida") {
      patch.resolvidaEm = new Date().toISOString();
      patch.resolvidaPor = me.id;
    }
    await updateDoc(doc(db, "ocorrencias", o.id), patch);
  }

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (loadingPerfis && !isMaster) {
    return <div className="text-sm text-gray-500 py-12 text-center">Carregando permissões…</div>;
  }
  if (!podeVer && !podeCriar) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">🚨 Ocorrências</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{restaurant.nome}</p>
        </div>
        {podeCriar && (
          <Button onClick={() => setEditing("new")}>+ Nova ocorrência</Button>
        )}
      </div>

      {/* Stats — apenas pra quem tem permissão de estatísticas */}
      {podeStats && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Hoje</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{hoje}</div>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Abertas</div>
            <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">{abertas}</div>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Graves (7d)</div>
            <div className="text-2xl font-bold text-rose-700 dark:text-rose-400">{graves7d}</div>
          </div>
        </div>
      )}

      {/* Quem só pode registrar (sem ver lista) — placeholder e fim. */}
      {!podeVer && podeCriar && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-6 text-center text-sm text-blue-800 dark:text-blue-300">
          <div className="text-3xl mb-2">📝</div>
          <p className="font-medium mb-1">Você pode registrar ocorrências</p>
          <p className="text-xs">A lista das ocorrências registradas fica visível só pra gestores. Após enviar, o gestor é notificado.</p>
        </div>
      )}

      {/* Busca + filtros + lista — visíveis só pra quem pode ver */}
      {podeVer && (
      <>
      <Input
        placeholder="🔍 Buscar por título, descrição, empregado, cliente..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-3"
      />

      {/* Filtros */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Gravidade:</span>
          {(["todas", "elogio", "leve", "media", "grave"] as const).map(g => (
            <button
              key={g}
              type="button"
              onClick={() => setFiltroGrav(g)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filtroGrav === g
                  ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
              }`}
            >
              {g === "todas" ? "Todas" : `${OCORRENCIA_GRAVIDADE_ICON[g]} ${OCORRENCIA_GRAVIDADE_LABEL[g]}`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Status:</span>
          {(["abertas", "aberta", "em_apuracao", "resolvida", "arquivada", "todas"] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setFiltroStatus(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filtroStatus === s
                  ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
              }`}
            >
              {s === "abertas" ? "📂 Abertas/em apur." : s === "todas" ? "Todas" : OCORRENCIA_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">🚨</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            {search || filtroGrav !== "todas" || filtroStatus !== "abertas"
              ? "Nada encontrado"
              : "Nenhuma ocorrência aberta"}
          </p>
          {!search && filtroStatus === "abertas" && podeCriar && (
            <p className="text-sm text-gray-500 mt-2">Cadastre clicando em "+ Nova ocorrência"</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(o => {
            const empNomes = o.empregadosEnvolvidos
              .map(id => empMap[id])
              .filter(Boolean)
              .map(e => {
                const cargo = cargoMap[e!.cargoId];
                return `${e!.nome}${cargo ? ` (${cargo.area})` : ""}`;
              });
            return (
              <div
                key={o.id}
                className={`rounded-xl border p-4 ${GRAVIDADE_CLS[o.gravidade]}`}
              >
                <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base">{OCORRENCIA_GRAVIDADE_ICON[o.gravidade]}</span>
                    <h3 className="font-bold text-gray-900 dark:text-gray-100">{o.titulo}</h3>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${STATUS_CLS[o.status]}`}>
                      {OCORRENCIA_STATUS_LABEL[o.status]}
                    </span>
                    {o.categoria && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/60 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                        {o.categoria}
                      </span>
                    )}
                  </div>
                  {podeEditar && (
                    <div className="flex gap-1 flex-wrap">
                      {o.status === "aberta" && (
                        <Button variant="secondary" size="sm" onClick={() => setStatus(o, "em_apuracao")}>📋 Apurar</Button>
                      )}
                      {(o.status === "aberta" || o.status === "em_apuracao") && (
                        <Button variant="secondary" size="sm" onClick={() => setEditing(o)}>✓ Resolver</Button>
                      )}
                      {(o.status === "aberta" || o.status === "em_apuracao") && (
                        <Button variant="secondary" size="sm" onClick={() => setStatus(o, "arquivada")}>📦 Arquivar</Button>
                      )}
                      {(o.status === "resolvida" || o.status === "arquivada") && (
                        <Button variant="secondary" size="sm" onClick={() => setStatus(o, "aberta")}>↻ Reabrir</Button>
                      )}
                      <Button variant="secondary" size="sm" onClick={() => setEditing(o)}>Editar</Button>
                      <Button variant="danger" size="sm" onClick={() => excluir(o)}>×</Button>
                    </div>
                  )}
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap mb-2">{o.descricao}</p>
                {o.resolucao && (
                  <div className="mt-2 p-2 rounded bg-white/40 dark:bg-gray-800/50 text-xs text-gray-700 dark:text-gray-300">
                    <strong>Resolução:</strong> {o.resolucao}
                  </div>
                )}
                <div className="flex items-center gap-3 flex-wrap text-xs text-gray-600 dark:text-gray-400 pt-2 mt-2 border-t border-gray-200 dark:border-gray-800">
                  <span>📅 {new Date(o.data + "T12:00:00").toLocaleDateString("pt-BR")}{o.hora ? ` ${o.hora}` : ""}</span>
                  {empNomes.length > 0 && <span>👤 {empNomes.join(", ")}</span>}
                  {o.clienteNome && <span>🪑 Cliente: {o.clienteNome}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </>
      )}

      {editing && (
        <OcorrenciaModal
          ocorrencia={editing === "new" ? null : editing}
          empregados={empregados}
          cargos={cargos}
          restaurantId={rid}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
