// Plano de Ação — a Ação como unidade executável. Fase 1: núcleo (criar avulsa,
// Kanban de gestão, "minhas ações", log de tratativas). Fases seguintes plugam
// ocorrências/ideias/reuniões e produção derivada.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { todayYmd } from "../../core/utils/date";
import { ACAO_STATUS_LABEL } from "../../core/types";
import type { Acao, PlanoAcaoStatus, Pessoa } from "../../core/types";
import { AcaoModal } from "./AcaoModal";

const uid = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const PRIO_BORDA: Record<string, string> = { alta: "border-rose-500", media: "border-amber-500", baixa: "border-gray-400" };
const fmtDia = (ymd?: string | null) => { if (!ymd) return ""; const d = new Date(ymd + "T12:00:00"); return isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }); };

const COLS: Array<{ id: PlanoAcaoStatus; titulo: string; borda: string }> = [
  { id: "aberta", titulo: "🎯 Abertas", borda: "border-t-blue-500" },
  { id: "em_andamento", titulo: "🔧 Em andamento", borda: "border-t-amber-500" },
  { id: "concluida", titulo: "✅ Concluídas", borda: "border-t-emerald-500" },
  { id: "cancelada", titulo: "🚫 Canceladas", borda: "border-t-gray-400" },
];

export function PlanoDeAcaoPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find(r => r.id === rid) || null;
  const isMaster = !!me?.isMaster;
  const { can, loading: loadingPerfis } = useCanAcao(rid);
  const podeCriar = isMaster || can("planoDeAcao", "criar");
  const podeGerenciar = isMaster || can("planoDeAcao", "gerenciar") || can("planoDeAcao", "ver");
  const podeEditar = isMaster || can("planoDeAcao", "editar");

  const [acoes, setAcoes] = useState<Acao[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [editing, setEditing] = useState<Acao | "new" | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [aba, setAba] = useState<"minhas" | "kanban">("minhas");

  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    const u1 = onSnapshot(query(collection(db, "acoes"), where("restaurantId", "==", rid)), snap => {
      setAcoes(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Acao).filter(a => a.ativo !== false));
      setLoading(false);
    });
    const u2 = onSnapshot(query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid)), snap => {
      setPessoas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa).filter(p => p.ativa !== false));
    });
    return () => { u1(); u2(); };
  }, [rid]);

  const today = todayYmd();
  const bn = busca.trim().toLowerCase();
  const filtradas = useMemo(() => acoes.filter(a => !bn || a.titulo.toLowerCase().includes(bn) || (a.descricao || "").toLowerCase().includes(bn) || (a.responsavelNome || "").toLowerCase().includes(bn)), [acoes, bn]);
  const minhas = useMemo(() => acoes.filter(a => a.responsavelId === me?.id).sort((a, b) => {
    const ordS = (s: PlanoAcaoStatus) => (s === "aberta" ? 0 : s === "em_andamento" ? 1 : 2);
    return ordS(a.status) - ordS(b.status) || (a.prazo || "9999").localeCompare(b.prazo || "9999");
  }), [acoes, me?.id]);
  const minhasAbertas = minhas.filter(a => a.status === "aberta" || a.status === "em_andamento").length;

  async function moverPara(a: Acao, status: PlanoAcaoStatus) {
    if (a.status === status) return;
    const now = new Date().toISOString();
    const log = [...(a.log || []), { id: uid("lg"), em: now, autorId: me?.id, autorNome: me?.nome, tipo: "status" as const, texto: `${ACAO_STATUS_LABEL[a.status]} → ${ACAO_STATUS_LABEL[status]}` }];
    try {
      await updateDoc(doc(db, "acoes", a.id), sanitizeForFirestore({
        status, log, atualizadoEm: now,
        concluidoEm: status === "concluida" ? (a.concluidoEm || now) : null,
        concluidoPor: status === "concluida" ? (a.concluidoPor || me?.id || null) : null,
      }));
    } catch (e) { alert("Falha ao mover: " + (e instanceof Error ? e.message : String(e))); }
  }

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (loadingPerfis && !isMaster) return <div className="text-sm text-gray-500 py-12 text-center">Carregando permissões…</div>;
  if (!podeGerenciar && !podeCriar) return <div className="max-w-2xl mx-auto py-12 text-center"><div className="text-4xl mb-3">🔒</div><p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p></div>;

  const mostrarTabs = podeGerenciar; // "minhas" sempre; "kanban" pra quem gerencia
  const abaEfetiva: "minhas" | "kanban" = aba === "kanban" && podeGerenciar ? "kanban" : "minhas";
  const prazoBadge = (a: Acao) => {
    if (!a.prazo || a.status === "concluida" || a.status === "cancelada") return null;
    const atrasada = a.prazo < today;
    const hoje = a.prazo === today;
    return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${atrasada ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : hoje ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-gray-100 text-gray-500 dark:bg-gray-800"}`}>{atrasada ? "⚠ atrasada" : hoje ? "vence hoje" : `📅 ${fmtDia(a.prazo)}`}</span>;
  };

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">🎯 Plano de Ação</h1>
          <p className="text-xs text-gray-500">{restaurant.nome} · ações com responsável, prazo e status</p>
        </div>
        {podeCriar && <Button onClick={() => setEditing("new")}>+ Nova ação</Button>}
      </div>

      {mostrarTabs && (
        <div className="flex items-center gap-1 mb-4 border-b border-gray-200 dark:border-gray-800">
          {([{ k: "minhas", l: `🙋 Minhas ações${minhasAbertas ? ` (${minhasAbertas})` : ""}` }, { k: "kanban", l: "📊 Todas (Kanban)" }] as const).map(t => (
            <button key={t.k} type="button" onClick={() => setAba(t.k)} className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${abaEfetiva === t.k ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"}`}>{t.l}</button>
          ))}
        </div>
      )}

      {/* MINHAS AÇÕES */}
      {abaEfetiva === "minhas" && (
        <div className="space-y-2">
          {loading ? <div className="text-sm text-gray-500">Carregando…</div>
            : minhas.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">Nenhuma ação atribuída a você.{podeCriar ? " Crie uma em “+ Nova ação”." : ""}</div>
            ) : minhas.map(a => (
              <button key={a.id} type="button" onClick={() => setEditing(a)} className={`w-full text-left flex items-center gap-3 rounded-xl border-l-4 ${PRIO_BORDA[a.prioridade || "media"]} border-y border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/40 p-3 ${a.status === "concluida" || a.status === "cancelada" ? "opacity-60" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{a.titulo}</div>
                  <div className="text-[11px] text-gray-500 flex items-center gap-2 flex-wrap mt-0.5">
                    <span className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">{ACAO_STATUS_LABEL[a.status]}</span>
                    {prazoBadge(a)}
                  </div>
                </div>
                <span className="text-xs text-indigo-600 dark:text-indigo-400 shrink-0">Abrir →</span>
              </button>
            ))}
        </div>
      )}

      {/* KANBAN (gestão) */}
      {abaEfetiva === "kanban" && podeGerenciar && (
        <>
          <div className="mb-3"><Input placeholder="🔍 Buscar por título, descrição ou responsável…" value={busca} onChange={e => setBusca(e.target.value)} /></div>
          {loading ? <div className="text-sm text-gray-500">Carregando…</div> : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 items-start">
              {COLS.map(col => {
                const lista = filtradas.filter(a => a.status === col.id);
                const alvo = dropTarget === col.id;
                return (
                  <div key={col.id}
                    onDragOver={podeEditar ? e => { e.preventDefault(); if (dropTarget !== col.id) setDropTarget(col.id); } : undefined}
                    onDragLeave={podeEditar ? () => { if (dropTarget === col.id) setDropTarget(null); } : undefined}
                    onDrop={podeEditar ? e => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); setDropTarget(null); setDraggingId(null); const a = acoes.find(x => x.id === id); if (a) void moverPara(a, col.id); } : undefined}
                    className={`bg-gray-50 dark:bg-gray-900/40 rounded-lg p-2 min-h-[300px] border-t-4 ${col.borda} transition-colors ${alvo ? "ring-2 ring-indigo-400 bg-indigo-50 dark:bg-indigo-900/30" : ""}`}>
                    <div className="mb-2 pb-1.5 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
                      <span className="font-bold text-xs text-gray-900 dark:text-gray-100">{col.titulo}</span>
                      <span className="text-[10px] text-gray-500">{lista.length}</span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {lista.map(a => (
                        <button key={a.id}
                          draggable={podeEditar}
                          onDragStart={podeEditar ? e => { e.dataTransfer.setData("text/plain", a.id); setDraggingId(a.id); } : undefined}
                          onDragEnd={podeEditar ? () => { setDraggingId(null); setDropTarget(null); } : undefined}
                          onClick={() => setEditing(a)}
                          className={`w-full text-left bg-white dark:bg-gray-900 border-l-4 ${PRIO_BORDA[a.prioridade || "media"]} border-y border-r border-gray-200 dark:border-gray-800 rounded-md p-2 text-xs ${podeEditar ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${draggingId === a.id ? "opacity-40" : ""} hover:border-indigo-400 transition-colors`}>
                          <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{a.titulo}</div>
                          <div className="text-[10px] text-gray-500 mt-1 flex items-center gap-1.5 flex-wrap">
                            {a.responsavelNome ? <span>👤 {a.responsavelNome}</span> : <span className="text-gray-400">sem responsável</span>}
                            {prazoBadge(a)}
                          </div>
                        </button>
                      ))}
                      {col.id === "aberta" && podeCriar && (
                        <button type="button" onClick={() => setEditing("new")} className="w-full text-left text-[11px] px-2 py-2 rounded-md border border-dashed border-indigo-300 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20">+ Nova ação</button>
                      )}
                      {lista.length === 0 && col.id !== "aberta" && <div className="text-[10px] text-gray-400 italic text-center py-4">—</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {editing && <AcaoModal acao={editing === "new" ? null : editing} rid={rid} pessoas={pessoas} meId={me?.id} meNome={me?.nome} onClose={() => setEditing(null)} />}
    </div>
  );
}
