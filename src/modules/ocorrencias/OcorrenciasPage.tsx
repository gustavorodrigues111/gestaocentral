import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { VirarAcaoModal } from "../planoDeAcao/VirarAcaoModal";
import type { Acao } from "../../core/types";
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
  aberta:         "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  em_apuracao:    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  gerada_reuniao: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  puxada_tarefa:  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  resolvida:      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  arquivada:      "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
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
  // Kanban de gestão: nova permissão "gerenciar" (ou "ver" legado, retrocompat).
  const podeGerenciar = isMaster || can("ocorrencias", "gerenciar") || can("ocorrencias", "ver");
  const podeVer       = podeGerenciar; // conteúdo do kanban reusa este gate
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
  const [virarDe, setVirarDe] = useState<Ocorrencia | null>(null);
  const [aba, setAba] = useState<"registrar" | "kanban">(() => {
    try { return (localStorage.getItem("ocorrencias_aba") as "registrar" | "kanban") || "registrar"; }
    catch { return "registrar"; }
  });
  useEffect(() => { try { localStorage.setItem("ocorrencias_aba", aba); } catch {} }, [aba]);
  const [view, setView] = useState<"lista" | "kanban">(() => {
    try { return (localStorage.getItem("ocorrencias_view") as "lista" | "kanban") || "kanban"; }
    catch { return "kanban"; }
  });
  useEffect(() => { try { localStorage.setItem("ocorrencias_view", view); } catch {} }, [view]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

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

  // Ocorrências que EU registrei (aba Registrar, pra quem não gerencia).
  const minhas = useMemo(
    () => ocorrencias.filter(o => o.criadaPor === me?.id),
    [ocorrencias, me?.id],
  );

  // Abas disponíveis conforme permissão.
  const abaEfetiva: "registrar" | "kanban" =
    aba === "kanban" && podeGerenciar ? "kanban"
    : podeCriar ? "registrar"
    : "kanban";
  const mostrarTabs = podeCriar && podeGerenciar;

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

  // Registra no log da ocorrência que ela virou ação (Plano de Ação).
  async function aposVirarAcao(o: Ocorrencia, acao: Acao) {
    const now = new Date().toISOString();
    const lg = { id: `lg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, em: now, autorId: me?.id, autorNome: me?.nome, tipo: "comentario" as const, texto: `Virou ação: "${acao.titulo}"${acao.responsavelNome ? ` — resp. ${acao.responsavelNome}` : ""}` };
    await updateDoc(doc(db, "ocorrencias", o.id), sanitizeForFirestore({ log: [...(o.log || []), lg], acaoIdGerada: acao.id, atualizadaEm: now }));
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
      {/* Abas: Registrar (criação) e Kanban (gestão) */}
      {mostrarTabs && (
        <div className="flex items-center gap-1 mb-4 border-b border-gray-200 dark:border-gray-800">
          {([{ k: "registrar", l: "📝 Registrar" }, { k: "kanban", l: "📊 Kanban" }] as const).map(t => (
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

      {/* ABA REGISTRAR — criação + histórico só das próprias */}
      {abaEfetiva === "registrar" && podeCriar && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">Registrar ocorrência</h2>
              <p className="text-[12px] text-gray-500 dark:text-gray-400">Descreva o que aconteceu — o gestor recebe e trata no Kanban.</p>
            </div>
            <Button onClick={() => setEditing("new")}>+ Nova ocorrência</Button>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Minhas ocorrências</div>
            {minhas.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">Você ainda não registrou nenhuma ocorrência.</p>
            ) : (
              <div className="space-y-1.5">
                {minhas.map(o => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setEditing(o)}
                    className="w-full text-left flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/60 p-3"
                  >
                    <span>{OCORRENCIA_GRAVIDADE_ICON[o.gravidade]}</span>
                    <span className="flex-1 min-w-0 text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{o.titulo}</span>
                    <span className="text-[11px] text-gray-500 tabular-nums">{new Date(o.data + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${STATUS_CLS[o.status]}`}>{OCORRENCIA_STATUS_LABEL[o.status]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA KANBAN — gestão (todas as ocorrências) */}
      {abaEfetiva === "kanban" && podeVer && (
      <>
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
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <Input
          placeholder="🔍 Buscar por título, descrição, empregado, cliente..."
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

      {view === "kanban" && <KanbanOcorrencias
        ocorrencias={ocorrencias.filter(o => !search.trim() || o.titulo.toLowerCase().includes(search.toLowerCase()) || o.descricao.toLowerCase().includes(search.toLowerCase()))}
        loading={loading}
        podeEditar={podeEditar}
        onAbrir={(o) => setEditing(o)}
        onNova={podeCriar ? () => setEditing("new") : undefined}
        draggingId={draggingId}
        dropTarget={dropTarget}
        setDraggingId={setDraggingId}
        setDropTarget={setDropTarget}
      />}

      {view === "lista" && (<>
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
                    {o.acaoIdGerada && <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" title="Virou uma ação no Plano de Ação">🎯 virou ação</span>}
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
                      {!o.acaoIdGerada && <Button variant="secondary" size="sm" onClick={() => setVirarDe(o)}>🎯 Virar ação</Button>}
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
                  {o.criadaPorNome && <span>✍️ {o.criadaPorNome}</span>}
                  {empNomes.length > 0 && <span>👤 {empNomes.join(", ")}</span>}
                  {o.clienteNome && <span>🪑 Cliente: {o.clienteNome}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </>)}
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
      {virarDe && (
        <VirarAcaoModal
          rid={rid} meId={me?.id} meNome={me?.nome}
          origem={{ tipo: "ocorrencia", refId: virarDe.id, label: virarDe.titulo }}
          tituloInicial={virarDe.titulo} descricaoInicial={virarDe.descricao}
          onClose={() => setVirarDe(null)}
          onCriada={(acao) => aposVirarAcao(virarDe, acao)}
        />
      )}
    </div>
  );
}

// ─── KANBAN ───────────────────────────────────────────────────────────────

const KANBAN_COLS_OC: Array<{ id: OcorrenciaStatus; titulo: string; descricao: string; bordaCls: string }> = [
  { id: "aberta",         titulo: "🚨 Abertas",          descricao: "Recém-registradas",                       bordaCls: "border-t-blue-500" },
  { id: "em_apuracao",    titulo: "🔍 Em apuração",      descricao: "Alguém apurando",                          bordaCls: "border-t-amber-500" },
  { id: "gerada_reuniao", titulo: "🗣️ De reunião",        descricao: "Geradas dentro de uma reunião",           bordaCls: "border-t-purple-500" },
  { id: "puxada_tarefa",  titulo: "✓ Viraram tarefa",   descricao: "Encerradas aqui, agora estão em Tarefas",  bordaCls: "border-t-emerald-500" },
  { id: "resolvida",      titulo: "✅ Resolvidas",        descricao: "Resolvidas sem virar tarefa",              bordaCls: "border-t-emerald-500" },
  { id: "arquivada",      titulo: "📦 Arquivadas",       descricao: "Arquivadas",                               bordaCls: "border-t-gray-400" },
];

function KanbanOcorrencias({ ocorrencias, loading, podeEditar, onAbrir, onNova, draggingId, dropTarget, setDraggingId, setDropTarget }: {
  ocorrencias: Ocorrencia[];
  loading: boolean;
  podeEditar: boolean;
  onAbrir: (o: Ocorrencia) => void;
  onNova?: () => void;
  draggingId: string | null;
  dropTarget: string | null;
  setDraggingId: (id: string | null) => void;
  setDropTarget: (id: string | null) => void;
}) {
  async function moverPara(id: string, status: OcorrenciaStatus) {
    try {
      await updateDoc(doc(db, "ocorrencias", id), { status, atualizadaEm: new Date().toISOString() });
    } catch (e) {
      console.error("[ocorrencias] falha ao mover:", e);
      alert("Falha ao mover ocorrência: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  const porCol: Record<OcorrenciaStatus, Ocorrencia[]> = {
    aberta: [], em_apuracao: [], gerada_reuniao: [], puxada_tarefa: [], resolvida: [], arquivada: [],
  };
  ocorrencias.forEach(o => { porCol[o.status]?.push(o); });

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 items-start">
      {KANBAN_COLS_OC.map(col => {
        const lista = porCol[col.id];
        const ehAlvo = dropTarget === col.id;
        return (
          <div
            key={col.id}
            onDragOver={podeEditar ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dropTarget !== col.id) setDropTarget(col.id);
            } : undefined}
            onDragLeave={podeEditar ? () => {
              if (dropTarget === col.id) setDropTarget(null);
            } : undefined}
            onDrop={podeEditar ? (e) => {
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
              {lista.map(o => {
                const arrastando = draggingId === o.id;
                return (
                  <button
                    key={o.id}
                    draggable={podeEditar}
                    onDragStart={podeEditar ? (e) => {
                      e.dataTransfer.setData("text/plain", o.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDraggingId(o.id);
                    } : undefined}
                    onDragEnd={podeEditar ? () => {
                      setDraggingId(null);
                      setDropTarget(null);
                    } : undefined}
                    onClick={() => onAbrir(o)}
                    className={`w-full text-left bg-white dark:bg-gray-900 border-l-4 ${
                      o.gravidade === "grave" ? "border-rose-500" :
                      o.gravidade === "media" ? "border-amber-500" :
                      o.gravidade === "leve" ? "border-blue-500" :
                      "border-emerald-500"
                    } border-y border-r border-gray-200 dark:border-gray-800 rounded-md p-2 text-xs ${podeEditar ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${arrastando ? "opacity-40" : ""} hover:border-indigo-400 transition-colors`}
                    title={podeEditar ? `${o.titulo} (arrastar pra mover)` : o.titulo}
                  >
                    <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1">
                      <span>{OCORRENCIA_GRAVIDADE_ICON[o.gravidade]}</span>
                      <span className="flex-1 truncate">{o.titulo}</span>
                    </div>
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                      {new Date(o.data + "T12:00:00").toLocaleDateString("pt-BR")}
                      {o.criadaPorNome && <span> · por {o.criadaPorNome}</span>}
                    </div>
                    {o.descricao && (
                      <div className="text-[10px] text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">{o.descricao}</div>
                    )}
                  </button>
                );
              })}
              {col.id === "aberta" && onNova && (
                <button
                  type="button"
                  onClick={onNova}
                  className="w-full text-left text-[11px] px-2 py-2 rounded-md border border-dashed border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:border-rose-500 transition-colors"
                  title="Registrar nova ocorrência"
                >
                  + Nova ocorrência
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
