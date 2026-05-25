import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, deleteDoc, doc, onSnapshot, query, where } from "firebase/firestore";
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
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">🗣️ Reuniões</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{restaurant.nome}</p>
        </div>
        {podeConfig && (
          <Button onClick={() => setEditing("new")}>+ Nova reunião</Button>
        )}
      </div>

      {acoesPendentes > 0 && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300 mb-3">
          📌 <strong>{acoesPendentes}</strong> aç{acoesPendentes > 1 ? "ões" : "ão"} pendente{acoesPendentes > 1 ? "s" : ""} de reuniões anteriores.
        </div>
      )}

      <Input
        placeholder="🔍 Buscar..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-3"
      />

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

      {loading ? (
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
      )}

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
