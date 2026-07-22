import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { VirarAcaoModal, type ItemCriado } from "../planoDeAcao/VirarAcaoModal";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canVer } from "../../core/auth/permissions";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { Ideia, IdeiaStatus, Reuniao } from "../../core/types";
import { IdeiaModal } from "./IdeiaModal";
import { ouvirIdeiasVisiveis, backfillVisibilidade } from "./ideiasData";
import { LevarParaReuniaoModal } from "./LevarParaReuniaoModal";

const STATUS_INFO: Record<IdeiaStatus, { label: string; cls: string }> = {
  aberta:         { label: "Nova",                cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  em_discussao:   { label: "Em discussão",        cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  gerada_reuniao: { label: "Gerada em reunião",   cls: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
  puxada_tarefa:  { label: "Puxada pra tarefa",   cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  descartada:     { label: "Descartada",          cls: "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
  em_pauta:       { label: "Em discussão",        cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  discutida:      { label: "Em discussão",        cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
};

export function IdeiasPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find(r => r.id === rid) || null;
  // Gates granulares. Submissor = qualquer um do time submete (aba Registrar).
  // Gerenciar = vê o Kanban de gestão (nova permissão; "moderar"/"ver" legado
  // servem de retrocompat).
  const { can } = useCanAcao(rid);
  const isMaster = !!me?.isMaster;
  const podeSubmeter = isMaster || can("ideias", "submeter");
  const podePrivadas = isMaster || can("ideias", "privadas");
  const podeGerenciar = isMaster || can("ideias", "gerenciar") || can("ideias", "moderar") || canVer(me, rid, "ideias");
  const podeModerar  = isMaster || can("ideias", "moderar");
  const podeExecutar = isMaster || can("ideias", "executar");
  void podeExecutar; // usado em refinamento futuro (botao "marcar implementada")

  const [ideias, setIdeias] = useState<Ideia[]>([]);
  const [reunioes, setReunioes] = useState<Reuniao[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"abertas" | "em_pauta" | "discutidas" | "descartadas" | "todas">("abertas");
  const [editing, setEditing] = useState<Ideia | "new" | null>(null);
  const [virarDe, setVirarDe] = useState<Ideia | null>(null);
  async function aposVirarAcao(i: Ideia, acao: ItemCriado) {
    const now = new Date().toISOString();
    const lg = { id: `lg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, em: now, autorId: me?.id, autorNome: me?.nome, tipo: "comentario" as const, texto: `Virou tarefa: "${acao.titulo}"${acao.responsavelNome ? ` — resp. ${acao.responsavelNome}` : ""}` };
    await updateDoc(doc(db, "ideias", i.id), sanitizeForFirestore({ log: [...(i.log || []), lg], acaoIdGerada: acao.id, atualizadoEm: now }));
  }
  const [levando, setLevando] = useState<Ideia | null>(null);
  const [aba, setAba] = useState<"registrar" | "kanban">(() => {
    try { return (localStorage.getItem("ideias_aba") as "registrar" | "kanban") || "registrar"; }
    catch { return "registrar"; }
  });
  useEffect(() => { try { localStorage.setItem("ideias_aba", aba); } catch {} }, [aba]);
  const [view, setView] = useState<"lista" | "kanban">(() => {
    try { return (localStorage.getItem("ideias_view") as "lista" | "kanban") || "kanban"; }
    catch { return "kanban"; }
  });
  useEffect(() => { try { localStorage.setItem("ideias_view", view); } catch {} }, [view]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!rid || !me?.id) return;
    setLoading(true);
    const unsub = ouvirIdeiasVisiveis([rid], me.id, isMaster, (list) => { setIdeias(list); setLoading(false); });
    return () => unsub();
  }, [rid, me?.id, isMaster]);

  // Backfill 1x por sessão: legado sem visibilidade → "publica" (senão não
  // aparece nas queries de público pra quem não é master).
  const backfilledRef = useRef(false);
  useEffect(() => {
    if (backfilledRef.current || !ideias.length) return;
    if (ideias.some((i) => i.visibilidade == null)) { backfilledRef.current = true; void backfillVisibilidade(ideias); }
  }, [ideias]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "reunioes"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setReunioes(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Reuniao));
    });
    return () => unsub();
  }, [rid]);

  const reuniaoMap = useMemo(() => {
    const m: Record<string, Reuniao> = {};
    reunioes.forEach(r => { m[r.id] = r; });
    return m;
  }, [reunioes]);

  const minhas = useMemo(() => ideias.filter(i => i.criadoPor === me?.id), [ideias, me?.id]);
  const abaEfetiva: "registrar" | "kanban" =
    aba === "kanban" && podeGerenciar ? "kanban"
    : podeSubmeter ? "registrar"
    : "kanban";
  const mostrarTabs = podeSubmeter && podeGerenciar;

  const filtered = useMemo(() => {
    return ideias.filter(i => {
      if (filtroStatus === "abertas"    && i.status !== "aberta")     return false;
      if (filtroStatus === "em_pauta"   && i.status !== "em_pauta")   return false;
      if (filtroStatus === "discutidas" && i.status !== "discutida")  return false;
      if (filtroStatus === "descartadas"&& i.status !== "descartada") return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        if (!i.titulo.toLowerCase().includes(s) && !(i.descricao || "").toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [ideias, filtroStatus, search]);

  async function excluir(i: Ideia) {
    if (!confirm(`Excluir "${i.titulo}"?`)) return;
    await deleteDoc(doc(db, "ideias", i.id));
  }

  async function descartar(i: Ideia) {
    if (!confirm(`Descartar "${i.titulo}"? Vai pra lista de descartadas mas não some.`)) return;
    await updateDoc(doc(db, "ideias", i.id), { status: "descartada", atualizadoEm: new Date().toISOString() });
  }

  async function reabrir(i: Ideia) {
    await updateDoc(doc(db, "ideias", i.id), { status: "aberta", reuniaoId: null, atualizadoEm: new Date().toISOString() });
  }

  if (!restaurant) {
    return <div className="text-gray-500">Selecione um restaurante.</div>;
  }
  if (!podeSubmeter && !podeGerenciar) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      {/* Abas: Registrar (criação) e Kanban (gestão) */}
      {mostrarTabs && (
        <div className="flex items-center gap-1 mb-4 border-b border-gray-200 dark:border-gray-800">
          {([{ k: "registrar", l: "💡 Registrar" }, { k: "kanban", l: "📊 Kanban" }] as const).map(t => (
            <button
              key={t.k}
              type="button"
              onClick={() => setAba(t.k)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                abaEfetiva === t.k
                  ? "border-indigo-600 text-indigo-700 dark:text-indigo-300"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              {t.l}
            </button>
          ))}
        </div>
      )}

      {/* ABA REGISTRAR — criação + só as próprias ideias */}
      {abaEfetiva === "registrar" && podeSubmeter && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">Sugerir ideia</h2>
              <p className="text-[12px] text-gray-500 dark:text-gray-400">Manda sua sugestão pra melhorar a casa — o gestor avalia no Kanban.</p>
            </div>
            <Button onClick={() => setEditing("new")}>+ Nova ideia</Button>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Minhas ideias</div>
            {minhas.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">Você ainda não sugeriu nenhuma ideia.</p>
            ) : (
              <div className="space-y-1.5">
                {minhas.map(i => {
                  const status = STATUS_INFO[i.status];
                  return (
                    <button
                      key={i.id}
                      type="button"
                      onClick={() => setEditing(i)}
                      className="w-full text-left flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/60 p-3"
                    >
                      <span className="flex-1 min-w-0 text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{i.titulo}</span>
                      <span className="text-[11px] text-gray-500 tabular-nums">{i.criadoEm && new Date(i.criadoEm).toLocaleDateString("pt-BR")}</span>
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${status.cls}`}>{status.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA KANBAN — gestão (todas as ideias) */}
      {abaEfetiva === "kanban" && podeGerenciar && (
      <>
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
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {([
            ["abertas",     "💡 Abertas"],
            ["em_pauta",    "🗓️ Em pauta"],
            ["discutidas",  "✓ Discutidas"],
            ["descartadas", "🗑 Descartadas"],
            ["todas",       "Todas"],
          ] as const).map(([f, label]) => (
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
              {label}
            </button>
          ))}
        </div>
      )}

      {view === "kanban" && <KanbanIdeias
        ideias={ideias.filter(i => !search.trim() || i.titulo.toLowerCase().includes(search.toLowerCase()) || (i.descricao || "").toLowerCase().includes(search.toLowerCase()))}
        loading={loading}
        podeModerar={podeModerar}
        onAbrir={(i) => setEditing(i)}
        onNova={podeSubmeter ? () => setEditing("new") : undefined}
        draggingId={draggingId}
        dropTarget={dropTarget}
        setDraggingId={setDraggingId}
        setDropTarget={setDropTarget}
      />}

      {view === "lista" && (loading ? (
        <div className="text-sm text-gray-500">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">💡</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            {search ? "Nenhuma ideia encontrada" : "Sem ideias por aqui"}
          </p>
          {!search && podeSubmeter && (
            <p className="text-sm text-gray-500 mt-2">Cadastre clicando em "+ Nova ideia"</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(i => {
            const status = STATUS_INFO[i.status];
            const reuniao = i.reuniaoId ? reuniaoMap[i.reuniaoId] : null;
            return (
              <div
                key={i.id}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4"
              >
                <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${status.cls}`}>
                      {status.label}
                    </span>
                    <h3 className="font-bold text-gray-900 dark:text-gray-100">{i.titulo}</h3>
                    {i.categoria && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                        {i.categoria}
                      </span>
                    )}
                    {i.acaoIdGerada && <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" title="Virou uma tarefa">🎯 virou tarefa</span>}
                  </div>
                  {(podeModerar || podeExecutar) && (
                    <div className="flex gap-1 flex-wrap">
                      {podeModerar && i.status === "aberta" && (
                        <Button variant="secondary" size="sm" onClick={() => setLevando(i)}>🗓️ Pra reunião</Button>
                      )}
                      {podeModerar && (i.status === "em_pauta" || i.status === "discutida" || i.status === "descartada") && (
                        <Button variant="secondary" size="sm" onClick={() => reabrir(i)}>↻ Reabrir</Button>
                      )}
                      {podeModerar && i.status === "aberta" && (
                        <Button variant="secondary" size="sm" onClick={() => descartar(i)}>🗑 Descartar</Button>
                      )}
                      {podeModerar && !i.acaoIdGerada && (
                        <Button variant="secondary" size="sm" onClick={() => setVirarDe(i)}>🎯 Virar tarefa</Button>
                      )}
                      {podeModerar && (
                        <Button variant="secondary" size="sm" onClick={() => setEditing(i)}>Editar</Button>
                      )}
                      {podeModerar && (
                        <Button variant="danger" size="sm" onClick={() => excluir(i)}>×</Button>
                      )}
                    </div>
                  )}
                </div>
                {i.descricao && (
                  <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap mb-2">{i.descricao}</p>
                )}
                <div className="text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-100 dark:border-gray-800">
                  {i.visibilidade === "privada" && <span className="text-indigo-600 dark:text-indigo-400 font-medium">🔒 privada · </span>}
                  📅 {i.criadoEm && new Date(i.criadoEm).toLocaleDateString("pt-BR")}
                  {i.criadoPorNome && <> · ✍️ {i.criadoPorNome}</>}
                  {reuniao && (
                    <> · 🗣️ {reuniao.titulo} ({new Date(reuniao.data + "T12:00:00").toLocaleDateString("pt-BR")})</>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      </>
      )}

      {editing && (
        <IdeiaModal
          ideia={editing === "new" ? null : editing}
          restaurantId={rid}
          podePrivadas={podePrivadas}
          onClose={() => setEditing(null)}
        />
      )}
      {virarDe && (
        <VirarAcaoModal
          rid={rid} meId={me?.id} meNome={me?.nome}
          origem={{ tipo: "ideia", refId: virarDe.id, label: virarDe.titulo }}
          tituloInicial={virarDe.titulo} descricaoInicial={virarDe.descricao}
          destino="tarefa"
          onClose={() => setVirarDe(null)}
          onCriada={(acao) => aposVirarAcao(virarDe, acao)}
        />
      )}
      {levando && (
        <LevarParaReuniaoModal
          ideia={levando}
          reunioes={reunioes.filter(r => r.status === "planejada")}
          restaurantId={rid}
          onClose={() => setLevando(null)}
        />
      )}
    </div>
  );
}

// ─── KANBAN ───────────────────────────────────────────────────────────────

const KANBAN_COLUNAS: Array<{ id: IdeiaStatus; titulo: string; descricao: string; bordaCls: string }> = [
  { id: "aberta",         titulo: "💡 Novas",            descricao: "Recém-registradas",                       bordaCls: "border-t-blue-500" },
  { id: "em_discussao",   titulo: "💬 Em discussão",     descricao: "Em pauta entre reuniões",                 bordaCls: "border-t-amber-500" },
  { id: "gerada_reuniao", titulo: "🗣️ De reunião",        descricao: "Geradas dentro de uma reunião",           bordaCls: "border-t-purple-500" },
  { id: "puxada_tarefa",  titulo: "✓ Viraram tarefa",   descricao: "Encerradas aqui, agora estão em Tarefas",  bordaCls: "border-t-emerald-500" },
  { id: "descartada",     titulo: "🗑 Descartadas",      descricao: "Não vão virar nada",                       bordaCls: "border-t-gray-400" },
];

// Normaliza status legados pra coluna kanban correspondente
function colunaIdeia(i: Ideia): IdeiaStatus {
  if (i.status === "em_pauta" || i.status === "discutida") return "em_discussao";
  return i.status;
}

function KanbanIdeias({ ideias, loading, podeModerar, onAbrir, onNova, draggingId, dropTarget, setDraggingId, setDropTarget }: {
  ideias: Ideia[];
  loading: boolean;
  podeModerar: boolean;
  onAbrir: (i: Ideia) => void;
  onNova?: () => void;
  draggingId: string | null;
  dropTarget: string | null;
  setDraggingId: (id: string | null) => void;
  setDropTarget: (id: string | null) => void;
}) {
  async function moverPara(id: string, status: IdeiaStatus) {
    try {
      await updateDoc(doc(db, "ideias", id), { status, atualizadoEm: new Date().toISOString() });
    } catch (e) {
      console.error("[ideias] falha ao mover:", e);
      alert("Falha ao mover ideia: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  const porColuna: Record<IdeiaStatus, Ideia[]> = {
    aberta: [], em_discussao: [], gerada_reuniao: [], puxada_tarefa: [], descartada: [],
    em_pauta: [], discutida: [],
  };
  ideias.forEach(i => {
    const col = colunaIdeia(i);
    porColuna[col].push(i);
  });

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 items-start">
      {KANBAN_COLUNAS.map(col => {
        const lista = porColuna[col.id];
        const ehAlvo = dropTarget === col.id;
        return (
          <div
            key={col.id}
            onDragOver={podeModerar ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dropTarget !== col.id) setDropTarget(col.id);
            } : undefined}
            onDragLeave={podeModerar ? () => {
              if (dropTarget === col.id) setDropTarget(null);
            } : undefined}
            onDrop={podeModerar ? (e) => {
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
            <div className="flex flex-col gap-1.5">
              {lista.map(i => {
                const arrastando = draggingId === i.id;
                return (
                  <button
                    key={i.id}
                    draggable={podeModerar}
                    onDragStart={podeModerar ? (e) => {
                      e.dataTransfer.setData("text/plain", i.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDraggingId(i.id);
                    } : undefined}
                    onDragEnd={podeModerar ? () => {
                      setDraggingId(null);
                      setDropTarget(null);
                    } : undefined}
                    onClick={() => onAbrir(i)}
                    className={`w-full text-left bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-md p-2 text-xs ${podeModerar ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${arrastando ? "opacity-40" : ""} hover:border-indigo-400 transition-colors`}
                    title={podeModerar ? `${i.titulo} (arrastar pra mover)` : i.titulo}
                  >
                    <div className="font-medium text-gray-900 dark:text-gray-100">{i.visibilidade === "privada" && <span title="privada">🔒 </span>}{i.titulo}</div>
                    {i.categoria && (
                      <div className="text-[9px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mt-0.5">{i.categoria}</div>
                    )}
                    {i.descricao && (
                      <div className="text-[10px] text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">{i.descricao}</div>
                    )}
                    {i.criadoPorNome && (
                      <div className="text-[9px] text-gray-400 dark:text-gray-500 mt-1">por {i.criadoPorNome}</div>
                    )}
                  </button>
                );
              })}
              {col.id === "aberta" && onNova && (
                <button
                  type="button"
                  onClick={onNova}
                  className="w-full text-left text-[11px] px-2 py-2 rounded-md border border-dashed border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:border-rose-500 transition-colors"
                  title="Registrar nova ideia"
                >
                  + Nova ideia
                </button>
              )}
              {lista.length === 0 && col.id !== "aberta" && (
                <div className="text-[10px] text-gray-400 dark:text-gray-600 italic text-center py-4">—</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
