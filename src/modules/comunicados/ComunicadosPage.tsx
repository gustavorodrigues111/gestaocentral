import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, deleteDoc, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfigurar, canVer } from "../../core/auth/permissions";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { todayYmd } from "../../core/utils/date";
import type { Comunicado, ComunicadoLeitura } from "../../core/types";
import { ComunicadoModal } from "./ComunicadoModal";

const PRIORIDADE_INFO = {
  info:    { label: "Info",    icon: "ℹ️", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  aviso:   { label: "Aviso",   icon: "⚠️", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  urgente: { label: "Urgente", icon: "🚨", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
};

export function ComunicadosPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find(r => r.id === rid) || null;
  const podeVer = canVer(me, rid, "comunicados");
  const podeConfig = canConfigurar(me, rid, "comunicados");
  // Granular: criar/editar/deletar separados. Fallback pra podeConfig
  // quando o perfil não veio (sistema antigo ainda regendo).
  const { can } = useCanAcao(rid);
  const podeCriar   = !!me?.isMaster || can("comunicados", "criar")   || podeConfig;
  const podeEditar  = !!me?.isMaster || can("comunicados", "editar")  || podeConfig;
  const podeDeletar = !!me?.isMaster || can("comunicados", "deletar") || podeConfig;

  const [comunicados, setComunicados] = useState<Comunicado[]>([]);
  const [leituras, setLeituras] = useState<ComunicadoLeitura[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"ativos" | "expirados" | "todos">("ativos");
  const [editing, setEditing] = useState<Comunicado | "new" | null>(null);

  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    const q = query(collection(db, "comunicados"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Comunicado);
      list.sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
      setComunicados(list);
      setLoading(false);
    });
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "comunicadosLeituras"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setLeituras(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ComunicadoLeitura));
    });
    return () => unsub();
  }, [rid]);

  // Map comunicadoId → quantidade de leituras
  const leiturasPorComunicado = useMemo(() => {
    const m: Record<string, number> = {};
    leituras.forEach(l => { m[l.comunicadoId] = (m[l.comunicadoId] || 0) + 1; });
    return m;
  }, [leituras]);

  const today = todayYmd();
  const filtered = useMemo(() => {
    return comunicados.filter(c => {
      const expirado = c.validoAte && c.validoAte < today;
      if (filtroStatus === "ativos" && (!c.ativo || expirado)) return false;
      if (filtroStatus === "expirados" && (c.ativo && !expirado)) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        if (!c.titulo.toLowerCase().includes(s) && !c.corpo.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [comunicados, filtroStatus, search, today]);

  async function excluir(c: Comunicado) {
    if (!confirm(`Excluir "${c.titulo}"?\n\nLeituras já registradas continuam no sistema, mas o comunicado some.`)) return;
    await deleteDoc(doc(db, "comunicados", c.id));
  }

  if (!restaurant) {
    return <div className="text-gray-500">Selecione um restaurante.</div>;
  }
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-end mb-4 flex-wrap gap-3">
        {podeCriar && (
          <Button onClick={() => setEditing("new")}>+ Novo comunicado</Button>
        )}
      </div>

      <Input
        placeholder="🔍 Buscar por título ou conteúdo..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-3"
      />

      <div className="flex items-center gap-2 mb-4">
        {(["ativos", "expirados", "todos"] as const).map(f => (
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
            {f === "ativos" ? "✓ Ativos" : f === "expirados" ? "○ Expirados" : "Todos"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">📣</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            {search ? "Nenhum comunicado encontrado" : "Nenhum comunicado cadastrado"}
          </p>
          {!search && podeCriar && (
            <p className="text-sm text-gray-500 mt-2">Cadastre clicando em "+ Novo comunicado"</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => {
            const expirado = c.validoAte && c.validoAte < today;
            const inativo = !c.ativo;
            const leituras = leiturasPorComunicado[c.id] || 0;
            const prio = PRIORIDADE_INFO[c.prioridade];
            return (
              <div
                key={c.id}
                className={`bg-white dark:bg-gray-900 border rounded-xl p-4 ${
                  inativo || expirado
                    ? "border-gray-200 dark:border-gray-800 opacity-60"
                    : "border-gray-200 dark:border-gray-800"
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${prio.cls}`}>
                      {prio.icon} {prio.label}
                    </span>
                    <h3 className="font-bold text-gray-900 dark:text-gray-100">{c.titulo}</h3>
                    {inativo && <span className="text-[10px] text-gray-500 uppercase">Inativo</span>}
                    {expirado && <span className="text-[10px] text-gray-500 uppercase">Expirado</span>}
                  </div>
                  {(podeEditar || podeDeletar) && (
                    <div className="flex gap-1">
                      {podeEditar && <Button variant="secondary" size="sm" onClick={() => setEditing(c)}>Editar</Button>}
                      {podeDeletar && <Button variant="danger" size="sm" onClick={() => excluir(c)}>🗑</Button>}
                    </div>
                  )}
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap mb-2">{c.corpo}</p>
                <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-100 dark:border-gray-800">
                  <div>
                    {c.criadoEm && <>📅 {new Date(c.criadoEm).toLocaleDateString("pt-BR")}</>}
                    {c.validoAte && <> · válido até {new Date(c.validoAte + "T12:00:00").toLocaleDateString("pt-BR")}</>}
                    <> · {destinatariosLabel(c)}</>
                  </div>
                  <div>
                    👁 {leituras} leitura{leituras !== 1 ? "s" : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ComunicadoModal
          comunicado={editing === "new" ? null : editing}
          restaurantId={rid}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function destinatariosLabel(c: Comunicado): string {
  if (c.destinatarios.tipo === "todos") return "Todos os empregados";
  if (c.destinatarios.tipo === "areas") return `Áreas: ${c.destinatarios.areas.join(", ")}`;
  return `${c.destinatarios.empregadoIds.length} empregado(s) específico(s)`;
}
