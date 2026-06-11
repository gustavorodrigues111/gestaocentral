import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfigurar, canVer } from "../../core/auth/permissions";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { SelfServiceRedirect } from "../../core/auth/SemPermissaoCard";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { todayYmd } from "../../core/utils/date";
import { REUNIAO_TIPO_LABEL } from "../../core/types";
import type { Reuniao, ReuniaoStatus, ReuniaoTipo } from "../../core/types";
import { ReuniaoEditorModal } from "./ReuniaoEditorModal";
import { ReuniaoDetalheModal } from "./ReuniaoDetalheModal";

const STATUS_INFO: Record<ReuniaoStatus, { label: string; cls: string }> = {
  planejada:  { label: "Planejada",  cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  realizada:  { label: "Realizada",  cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  cancelada:  { label: "Cancelada",  cls: "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
};

const TIPO_ICON: Record<ReuniaoTipo, string> = {
  lideres:    "👔",
  equipe:     "👥",
  individual: "🧑",
  outro:      "🗣️",
};

export function ReunioesPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find(r => r.id === rid) || null;
  const podeVer = canVer(me, rid, "reunioes");
  const podeConfig = canConfigurar(me, rid, "reunioes");
  // Granular — só pra distinguir self-service do resto
  const { can, loading: loadingPerfis } = useCanAcao(rid);
  const podeVerTodas = !!me?.isMaster
    || can("reunioes", "verTodas") || can("reunioes", "criar")
    || can("reunioes", "editar") || can("reunioes", "pauta")
    || can("reunioes", "verPassadas");

  const [reunioes, setReunioes] = useState<Reuniao[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"proximas" | "passadas" | "todas">("proximas");
  const [editing, setEditing] = useState<Reuniao | "new" | null>(null);
  const [detalhe, setDetalhe] = useState<Reuniao | null>(null);
  const [view, setView] = useState<"lista" | "kanban">(() => {
    try { return (localStorage.getItem("reunioes_view") as "lista" | "kanban") || "kanban"; }
    catch { return "kanban"; }
  });
  useEffect(() => { try { localStorage.setItem("reunioes_view", view); } catch {} }, [view]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    const q = query(collection(db, "reunioes"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Reuniao);
      list.sort((a, b) => (b.data || "").localeCompare(a.data || ""));
      setReunioes(list);
      setLoading(false);
    });
    return () => unsub();
  }, [rid]);

  const today = todayYmd();
  const filtered = useMemo(() => {
    return reunioes.filter(r => {
      if (filtroStatus === "proximas" && (r.data < today || r.status === "realizada" || r.status === "cancelada")) return false;
      if (filtroStatus === "passadas" && r.data >= today && r.status === "planejada") return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        if (!r.titulo.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [reunioes, filtroStatus, search, today]);

  // Sync detalhe quando a reunião muda no snapshot (ex: mudou pauta)
  const detalheLive = detalhe ? reunioes.find(r => r.id === detalhe.id) || null : null;

  async function excluir(r: Reuniao) {
    if (!confirm(`Excluir "${r.titulo}"? Pauta, ata e ações vão junto.`)) return;
    await deleteDoc(doc(db, "reunioes", r.id));
  }

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (loadingPerfis && !me?.isMaster) {
    return <div className="text-sm text-gray-500 py-12 text-center">Carregando permissões...</div>;
  }
  if (!podeVer || !podeVerTodas) {
    return (
      <SelfServiceRedirect
        restaurantId={rid}
        icone="🗣️"
        titulo="Suas reuniões estão no Meu Portal"
        descricao="Essa tela é a agenda completa do restaurante. Pra ver as reuniões agendadas pra você, vai em Meu Portal."
      />
    );
  }

  // Conta ações pendentes (todas as reuniões realizadas)
  const acoesPendentes = reunioes
    .flatMap(r => r.acoes || [])
    .filter(a => a.status === "pendente").length;

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div />
        {podeConfig && (
          <Button onClick={() => setEditing("new")}>+ Nova reunião</Button>
        )}
      </div>

      {acoesPendentes > 0 && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300 mb-3">
          📌 <strong>{acoesPendentes}</strong> aç{acoesPendentes > 1 ? "ões" : "ão"} pendente{acoesPendentes > 1 ? "s" : ""} de reuniões anteriores.
        </div>
      )}

      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <Input
          placeholder="🔍 Buscar..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px]"
        />
        <div className="inline-flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
          {(["kanban", "lista"] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                view === v
                  ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
              }`}
            >
              {v === "kanban" ? "📊 Kanban" : "📋 Lista"}
            </button>
          ))}
        </div>
      </div>

      {view === "lista" && (
      <div className="flex items-center gap-2 mb-4">
        {(["proximas", "passadas", "todas"] as const).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltroStatus(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filtroStatus === f
                ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
            }`}
          >
            {f === "proximas" ? "📅 Próximas" : f === "passadas" ? "✓ Passadas" : "Todas"}
          </button>
        ))}
      </div>
      )}

      {view === "kanban" && <KanbanReunioes
        reunioes={reunioes.filter(r => !search.trim() || r.titulo.toLowerCase().includes(search.toLowerCase()))}
        loading={loading}
        podeConfig={podeConfig}
        onAbrir={(r) => setDetalhe(r)}
        onNova={podeConfig ? () => setEditing("new") : undefined}
        draggingId={draggingId}
        dropTarget={dropTarget}
        setDraggingId={setDraggingId}
        setDropTarget={setDropTarget}
      />}

      {view === "lista" && (loading ? (
        <div className="text-sm text-gray-500">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">🗣️</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            {search ? "Nada encontrado" : "Nenhuma reunião"}
          </p>
          {!search && podeConfig && (
            <p className="text-sm text-gray-500 mt-2">Crie clicando em "+ Nova reunião"</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(r => {
            const status = STATUS_INFO[r.status];
            const acoesPend = (r.acoes || []).filter(a => a.status === "pendente").length;
            const topicosDisc = (r.pauta || []).filter(t => t.discutido).length;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setDetalhe(r)}
                className="w-full text-left bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-indigo-400 dark:hover:border-indigo-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base">{TIPO_ICON[r.tipo]}</span>
                    <h3 className="font-bold text-gray-900 dark:text-gray-100">{r.titulo}</h3>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${status.cls}`}>
                      {status.label}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                      {REUNIAO_TIPO_LABEL[r.tipo]}
                    </span>
                  </div>
                  {podeConfig && (
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button variant="secondary" size="sm" onClick={() => setEditing(r)}>Editar</Button>
                      <Button variant="danger" size="sm" onClick={() => excluir(r)}>×</Button>
                    </div>
                  )}
                </div>
                <div className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-3 flex-wrap">
                  <span>📅 {new Date(r.data + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                  {r.horario && <span>⏰ {r.horario}</span>}
                  {r.local && <span>📍 {r.local}</span>}
                </div>
                <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-gray-500 dark:text-gray-400 pt-2 mt-2 border-t border-gray-100 dark:border-gray-800">
                  <div>
                    👥 {r.participantes?.length || 0} participante(s)
                    {r.pauta && r.pauta.length > 0 && (
                      <> · 📋 {topicosDisc}/{r.pauta.length} tópico(s) discutido(s)</>
                    )}
                  </div>
                  {acoesPend > 0 && (
                    <span className="text-amber-700 dark:text-amber-400 font-medium">
                      ⚠️ {acoesPend} aç{acoesPend > 1 ? "ões" : "ão"} pendente{acoesPend > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ))}

      {editing && (
        <ReuniaoEditorModal
          reuniao={editing === "new" ? null : editing}
          restaurantId={rid}
          onClose={() => setEditing(null)}
        />
      )}
      {detalheLive && (
        <ReuniaoDetalheModal
          reuniao={detalheLive}
          restaurantId={rid}
          podeConfig={podeConfig}
          onClose={() => setDetalhe(null)}
        />
      )}
    </div>
  );
}

// ─── KANBAN ───────────────────────────────────────────────────────────────

const KANBAN_COLS_R: Array<{ id: ReuniaoStatus; titulo: string; descricao: string; bordaCls: string }> = [
  { id: "planejada", titulo: "📅 Planejadas", descricao: "Marcadas pra acontecer",                  bordaCls: "border-t-blue-500" },
  { id: "realizada", titulo: "✅ Realizadas", descricao: "Já ocorreram (com ata e ações)",          bordaCls: "border-t-emerald-500" },
  { id: "cancelada", titulo: "✕ Canceladas", descricao: "Não vão acontecer",                       bordaCls: "border-t-gray-400" },
];

function KanbanReunioes({ reunioes, loading, podeConfig, onAbrir, onNova, draggingId, dropTarget, setDraggingId, setDropTarget }: {
  reunioes: Reuniao[];
  loading: boolean;
  podeConfig: boolean;
  onAbrir: (r: Reuniao) => void;
  onNova?: () => void;
  draggingId: string | null;
  dropTarget: string | null;
  setDraggingId: (id: string | null) => void;
  setDropTarget: (id: string | null) => void;
}) {
  const today = todayYmd();

  async function moverPara(id: string, status: ReuniaoStatus) {
    // Drag direto só muda o status — sem cascata em ideias linkadas.
    // Pra cascata completa (marcar realizada, cancelar com retroagir),
    // o usuário abre o detalhe e usa os botões dedicados (mais explícito).
    try {
      await updateDoc(doc(db, "reunioes", id), {
        status,
        atualizadoEm: new Date().toISOString(),
      });
    } catch (e) {
      console.error("[reunioes] falha ao mover:", e);
      alert("Falha ao mover reunião: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  // Cutoff pra mover automático pro histórico (mantém o kanban limpo):
  // - canceladas com mais de 14 dias  → histórico
  // - realizadas com mais de 45 dias  → histórico
  // Planejadas nunca vão pra histórico (mesmo vencidas) — DP precisa ver
  // pra tomar ação. Comparação pela data da REUNIÃO, não atualizadoEm.
  const todayDate = new Date(today + "T00:00:00");
  const cutoff14 = new Date(todayDate); cutoff14.setDate(cutoff14.getDate() - 14);
  const cutoff45 = new Date(todayDate); cutoff45.setDate(cutoff45.getDate() - 45);
  const cutoff14Ymd = cutoff14.toISOString().slice(0, 10);
  const cutoff45Ymd = cutoff45.toISOString().slice(0, 10);

  function vaiPraHistorico(r: Reuniao): boolean {
    if (r.status === "cancelada" && r.data && r.data < cutoff14Ymd) return true;
    if (r.status === "realizada" && r.data && r.data < cutoff45Ymd) return true;
    return false;
  }

  const porCol: Record<ReuniaoStatus, Reuniao[]> = { planejada: [], realizada: [], cancelada: [] };
  const historico: Reuniao[] = [];
  reunioes.forEach(r => {
    if (vaiPraHistorico(r)) historico.push(r);
    else porCol[r.status]?.push(r);
  });

  // Planejadas ordena por data crescente (próxima primeiro). Resto desc.
  porCol.planejada.sort((a, b) => (a.data || "").localeCompare(b.data || ""));
  porCol.realizada.sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  porCol.cancelada.sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  historico.sort((a, b) => (b.data || "").localeCompare(a.data || ""));

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="space-y-4">
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 overflow-x-auto">
      {KANBAN_COLS_R.map(col => {
        const lista = porCol[col.id];
        const ehAlvo = dropTarget === col.id;
        return (
          <div
            key={col.id}
            onDragOver={podeConfig ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dropTarget !== col.id) setDropTarget(col.id);
            } : undefined}
            onDragLeave={podeConfig ? () => {
              if (dropTarget === col.id) setDropTarget(null);
            } : undefined}
            onDrop={podeConfig ? (e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              setDropTarget(null);
              setDraggingId(null);
              if (id) moverPara(id, col.id);
            } : undefined}
            className={`bg-gray-50 dark:bg-gray-900/40 rounded-lg p-2 min-h-[300px] border-t-4 ${col.bordaCls} transition-colors ${ehAlvo ? "ring-2 ring-indigo-400 bg-indigo-50 dark:bg-indigo-900/30" : ""}`}
          >
            <div className="mb-2 pb-1.5 border-b border-gray-200 dark:border-gray-800">
              <div className="font-bold text-xs text-gray-900 dark:text-gray-100 flex items-center justify-between">
                <span>{col.titulo}</span>
                <span className="text-[10px] font-normal text-gray-500">{lista.length}</span>
              </div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{col.descricao}</div>
            </div>
            <div className="space-y-1.5">
              {lista.map(r => {
                const arrastando = draggingId === r.id;
                const vencida = col.id === "planejada" && r.data < today;
                const acoesPend = (r.acoes || []).filter(a => a.status === "pendente").length;
                const topicosTotal = (r.pauta || []).length;
                const topicosDisc = (r.pauta || []).filter(t => t.discutido).length;
                return (
                  <button
                    key={r.id}
                    draggable={podeConfig}
                    onDragStart={podeConfig ? (e) => {
                      e.dataTransfer.setData("text/plain", r.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDraggingId(r.id);
                    } : undefined}
                    onDragEnd={podeConfig ? () => {
                      setDraggingId(null);
                      setDropTarget(null);
                    } : undefined}
                    onClick={() => onAbrir(r)}
                    className={`w-full text-left bg-white dark:bg-gray-900 rounded-md p-2 text-xs border ${vencida ? "border-rose-300 dark:border-rose-700" : "border-gray-200 dark:border-gray-800"} ${podeConfig ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${arrastando ? "opacity-40" : ""} hover:border-indigo-400 transition-colors`}
                    title={podeConfig ? `${r.titulo} (arrastar pra mover)` : r.titulo}
                  >
                    <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1">
                      <span>{TIPO_ICON[r.tipo]}</span>
                      <span className="flex-1 truncate">{r.titulo}</span>
                    </div>
                    <div className={`text-[10px] mt-0.5 ${vencida ? "text-rose-600 dark:text-rose-400 font-medium" : "text-gray-500 dark:text-gray-400"}`}>
                      📅 {new Date(r.data + "T12:00:00").toLocaleDateString("pt-BR")}{r.horario && ` ${r.horario}`}
                      {vencida && " · vencida"}
                    </div>
                    {(topicosTotal > 0 || acoesPend > 0) && (
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-2 flex-wrap">
                        {topicosTotal > 0 && <span>📋 {topicosDisc}/{topicosTotal}</span>}
                        {acoesPend > 0 && <span className="text-amber-600 dark:text-amber-400">⚠️ {acoesPend} ação</span>}
                      </div>
                    )}
                  </button>
                );
              })}
              {col.id === "planejada" && onNova && (
                <button
                  type="button"
                  onClick={onNova}
                  className="w-full text-left text-[11px] px-2 py-2 rounded-md border border-dashed border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:border-rose-500 transition-colors"
                  title="Agendar nova reunião"
                >
                  + Nova reunião
                </button>
              )}
              {lista.length === 0 && col.id !== "planejada" && (
                <div className="text-[10px] text-gray-400 dark:text-gray-600 italic text-center py-4">—</div>
              )}
            </div>
          </div>
        );
      })}
    </div>

    {/* Histórico: canceladas > 14 dias + realizadas > 45 dias.
        Renderizado abaixo do Kanban, accordion fechado por padrão. */}
    {historico.length > 0 && (
      <HistoricoReunioes itens={historico} onAbrir={onAbrir} />
    )}
    </div>
  );
}

function HistoricoReunioes({ itens, onAbrir }: {
  itens: Reuniao[];
  onAbrir: (r: Reuniao) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const nCanceladas = itens.filter(r => r.status === "cancelada").length;
  const nRealizadas = itens.length - nCanceladas;
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-900/20">
      <button
        type="button"
        onClick={() => setAberto(a => !a)}
        className="w-full px-3 py-2 flex items-center justify-between text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/40 rounded-t-lg"
      >
        <span className="flex items-center gap-2">
          <span className={`transition-transform leading-none ${aberto ? "" : "-rotate-90"}`}>▾</span>
          <span className="font-semibold">📚 Histórico</span>
          <span className="text-gray-500 dark:text-gray-400">
            ({itens.length} — {nRealizadas} realizadas há +45d, {nCanceladas} canceladas há +14d)
          </span>
        </span>
        <span className="text-[10px] text-gray-400">{aberto ? "ocultar" : "expandir"}</span>
      </button>
      {aberto && (
        <div className="px-3 pb-3 space-y-1">
          {itens.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => onAbrir(r)}
              className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-white dark:hover:bg-gray-900 border border-transparent hover:border-gray-200 dark:hover:border-gray-800 flex items-center gap-2"
            >
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider ${
                r.status === "cancelada"
                  ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              }`}>
                {r.status === "cancelada" ? "cancelada" : "realizada"}
              </span>
              <span className="text-gray-500 dark:text-gray-400 tabular-nums">
                {r.data ? new Date(r.data + "T12:00:00").toLocaleDateString("pt-BR") : "—"}
              </span>
              <span className="flex-1 truncate text-gray-900 dark:text-gray-100">{r.titulo}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
