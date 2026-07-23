// Lente enxuta ("Tarefas" operacional, antigo Plano de Ação) — a mesma coleção
// `tarefas` do Gestor, numa interface simples e mobile pra quem executa no dia.
// Mostra as tarefas da pessoa (responsável) no restaurante ativo; líder com
// verTodas vê as da equipe. Concluir com um toque + andamento por comentário.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { todayYmd } from "../../core/utils/date";
import { TAREFA_ORIGEM_LABEL } from "../../core/types";
import type { Tarefa, Pessoa, TarefaOrigem, TarefaPrioridade } from "../../core/types";
import { ouvirTarefasDeUsuario, atualizarTarefa, adicionarComentario, criarTarefaOperacional } from "../tarefas/repository";

const OPERACIONAL = "proj-operacao-dem";
const fmtDia = (ymd?: string | null) => { if (!ymd) return ""; const [, m, d] = ymd.split("-"); return `${d}/${m}`; };
const STRIP: Record<TarefaPrioridade, string> = { urgente: "bg-rose-500", alta: "bg-rose-500", normal: "bg-amber-500", baixa: "bg-gray-300 dark:bg-gray-600" };
const ORIGEM_ICONE: Partial<Record<TarefaOrigem, string>> = { ocorrencia: "🚨", ideia: "💡", reuniao: "🗣️", avaliacao_sanitaria: "🧪", recorrencia: "🔁" };

export function LenteEnxutaPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find(r => r.id === rid) || null;
  const isMaster = !!me?.isMaster;
  const { can, loading: loadingPerfis } = useCanAcao(rid);
  const podeVerTodas = isMaster || can("planoDeAcao", "verTodas") || can("planoDeAcao", "ver") || can("planoDeAcao", "gerenciar");
  const podeCriar = isMaster || can("planoDeAcao", "criar");
  const podeEditar = isMaster || can("planoDeAcao", "editar");

  const [escopo, setEscopo] = useState<"minhas" | "equipe">("minhas");
  const [minhasTarefas, setMinhasTarefas] = useState<Tarefa[]>([]);
  const [equipeTarefas, setEquipeTarefas] = useState<Tarefa[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [mostrarFeitas, setMostrarFeitas] = useState(false);
  const [mostrarProximas, setMostrarProximas] = useState(false);

  useEffect(() => { if (!me?.id) return; return ouvirTarefasDeUsuario(me.id, setMinhasTarefas); }, [me?.id]);
  useEffect(() => {
    if (!rid || !podeVerTodas) { setEquipeTarefas([]); return; }
    return onSnapshot(query(collection(db, "tarefas"), where("restaurantIds", "array-contains", rid)),
      s => setEquipeTarefas(s.docs.map(d => ({ id: d.id, ...d.data() }) as Tarefa).filter(t => t.projetoId === OPERACIONAL)),
      () => setEquipeTarefas([]));
  }, [rid, podeVerTodas]);
  useEffect(() => {
    if (!rid) return;
    return onSnapshot(query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid)),
      s => setPessoas(s.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa).filter(p => p.ativa !== false)));
  }, [rid]);

  const hoje = todayYmd();
  const base = escopo === "equipe" && podeVerTodas ? equipeTarefas : minhasTarefas.filter(t => !t.restaurantIds?.length || t.restaurantIds.includes(rid));
  const semLixo = useMemo(() => base.filter(t => !t.deletadoEm), [base]);

  const abertas = useMemo(() => semLixo
    .filter(t => t.status === "a_fazer" || t.status === "em_andamento")
    .sort((a, b) => (a.prazo || "9999").localeCompare(b.prazo || "9999")), [semLixo]);
  const feitas = useMemo(() => semLixo.filter(t => t.status === "concluida")
    .sort((a, b) => (b.atualizadoEm || "").localeCompare(a.atualizadoEm || "")).slice(0, 20), [semLixo]);

  // "Meu dia": agrupa por urgência. Sem prazo cai em Hoje (é o que fazer agora).
  const grupos = useMemo(() => {
    const atrasadas: Tarefa[] = [], hojeL: Tarefa[] = [], prox: Tarefa[] = [];
    for (const t of abertas) {
      if (t.prazo && t.prazo < hoje) atrasadas.push(t);
      else if (!t.prazo || t.prazo === hoje) hojeL.push(t);
      else prox.push(t);
    }
    return { atrasadas, hojeL, prox };
  }, [abertas, hoje]);
  const feitasHoje = useMemo(() => feitas.filter(t => (t.atualizadoEm || "").slice(0, 10) === hoje), [feitas, hoje]);
  const totalDia = grupos.atrasadas.length + grupos.hojeL.length + feitasHoje.length;
  const pct = totalDia ? Math.round((feitasHoje.length / totalDia) * 100) : 0;

  const autor = { id: me?.id || "", nome: me?.nome || "?" };
  async function concluir(t: Tarefa, feito: boolean) {
    await atualizarTarefa(t.id, { status: feito ? "concluida" : "a_fazer" }, autor, { acao: "status_mudou", detalhe: feito ? "Concluída" : "Reaberta" });
  }

  const prazoBadge = (t: Tarefa) => {
    if (!t.prazo || t.status === "concluida") return null;
    const atrasada = t.prazo < hoje, ehHoje = t.prazo === hoje;
    return <span className={`text-[11px] px-1.5 py-0.5 rounded ${atrasada ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : ehHoje ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-gray-100 text-gray-500 dark:bg-gray-800"}`}>{atrasada ? "⚠ atrasada" : ehHoje ? "vence hoje" : `📅 ${fmtDia(t.prazo)}`}</span>;
  };

  if (!restaurant) return <div className="text-gray-500 p-4">Selecione um restaurante.</div>;
  if (loadingPerfis && !isMaster) return <div className="text-sm text-gray-500 py-12 text-center">Carregando…</div>;

  const podeConcluir = (t: Tarefa) => podeEditar || t.responsavelId === me?.id;

  const Card = ({ t }: { t: Tarefa }) => {
    const aberto = expandido === t.id;
    const feita = t.status === "concluida";
    const coments = t.comentarios || [];
    return (
      <div className={`flex bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden ${feita ? "opacity-70" : ""}`}>
        <div className={`w-1 shrink-0 ${feita ? "bg-emerald-500" : STRIP[t.prioridade] || "bg-gray-300"}`} />
        <div className="flex-1 min-w-0 p-3">
          <div className="flex gap-2.5 items-start">
            <button type="button" disabled={!podeConcluir(t)} onClick={() => void concluir(t, !feita)} className={`text-xl leading-none mt-0.5 shrink-0 ${feita ? "text-emerald-500" : "text-gray-300 dark:text-gray-600 hover:text-emerald-500"} disabled:opacity-40`} title={feita ? "Reabrir" : "Concluir"}>{feita ? "☑" : "☐"}</button>
            <div className="flex-1 min-w-0">
              <div className={`text-[14px] leading-snug ${feita ? "line-through text-gray-400" : "text-gray-900 dark:text-gray-100"}`}>{t.titulo}</div>
              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                {t.origem && t.origem !== "manual" && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">{ORIGEM_ICONE[t.origem] || ""} {TAREFA_ORIGEM_LABEL[t.origem]}</span>}
                {prazoBadge(t)}
                {escopo === "equipe" && t.responsavelNome && <span className="text-[11px] text-gray-500">👤 {t.responsavelNome}</span>}
                <button type="button" onClick={() => setExpandido(aberto ? null : t.id)} className="text-[11px] text-gray-400 hover:text-indigo-600">💬 {coments.length}</button>
              </div>
              {aberto && (
                <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-gray-800 space-y-2">
                  {coments.length === 0 && <div className="text-[11px] text-gray-400">Sem andamentos ainda.</div>}
                  {coments.slice(-4).map(c => (
                    <div key={c.id} className="text-[12px] text-gray-600 dark:text-gray-300"><span className="font-medium">{c.autorNome}:</span> {c.texto} <span className="text-gray-400">· {new Date(c.criadoEm).toLocaleDateString("pt-BR")}</span></div>
                  ))}
                  <ComentarInput tarefaId={t.id} autor={autor} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">✅ Tarefas</h1>
          <p className="text-xs text-gray-500">{restaurant.nome} · o que fazer</p>
        </div>
        {podeCriar && <button type="button" onClick={() => setNovo(true)} className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white">+ Nova</button>}
      </div>

      {podeVerTodas && (
        <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5 mb-3">
          {([["minhas", "🙋 Minhas"], ["equipe", "👥 Da equipe"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setEscopo(k)} className={`px-3 py-1 text-sm font-medium rounded-md ${escopo === k ? "bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 shadow-sm" : "text-gray-500"}`}>{l}</button>
          ))}
        </div>
      )}

      {totalDia > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-xs text-gray-500 mb-1"><span>{feitasHoje.length} de {totalDia} feitas hoje</span><span className="text-gray-400 tabular-nums">{pct}%</span></div>
          <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} /></div>
        </div>
      )}

      {abertas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">Nada pra fazer aqui. 🎉</div>
      ) : (
        <div className="space-y-4">
          {grupos.atrasadas.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-rose-600 dark:text-rose-400 mb-2">⚠ Atrasadas · {grupos.atrasadas.length}</div>
              <div className="grid gap-2 lg:grid-cols-2 items-start">{grupos.atrasadas.map(t => <Card key={t.id} t={t} />)}</div>
            </div>
          )}
          {grupos.hojeL.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-2">☀ Hoje · {grupos.hojeL.length}</div>
              <div className="grid gap-2 lg:grid-cols-2 items-start">{grupos.hojeL.map(t => <Card key={t.id} t={t} />)}</div>
            </div>
          )}
          {grupos.prox.length > 0 && (
            <div>
              <button type="button" onClick={() => setMostrarProximas(!mostrarProximas)} className="text-xs font-semibold text-gray-500 hover:text-gray-700 mb-2">{mostrarProximas ? "▾" : "▸"} Próximas · {grupos.prox.length}</button>
              {mostrarProximas && <div className="grid gap-2 lg:grid-cols-2 items-start">{grupos.prox.map(t => <Card key={t.id} t={t} />)}</div>}
            </div>
          )}
        </div>
      )}

      {feitas.length > 0 && (
        <div className="mt-4">
          <button type="button" onClick={() => setMostrarFeitas(!mostrarFeitas)} className="text-xs font-medium text-gray-500 hover:text-gray-700">{mostrarFeitas ? "▾" : "▸"} Feitas · {feitas.length}</button>
          {mostrarFeitas && <div className="grid gap-2 lg:grid-cols-2 items-start mt-2">{feitas.map(t => <Card key={t.id} t={t} />)}</div>}
        </div>
      )}

      {novo && <NovaTarefaEnxuta rid={rid} pessoas={pessoas} podeVerTodas={podeVerTodas} autor={autor} onClose={() => setNovo(false)} />}
    </div>
  );
}

function ComentarInput({ tarefaId, autor }: { tarefaId: string; autor: { id: string; nome: string } }) {
  const [txt, setTxt] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function enviar() {
    if (!txt.trim()) return;
    setEnviando(true);
    try { await adicionarComentario(tarefaId, txt.trim(), autor); setTxt(""); }
    finally { setEnviando(false); }
  }
  return (
    <div className="flex items-center gap-1.5">
      <input value={txt} onChange={e => setTxt(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void enviar(); }} placeholder="Escreva um andamento…" className="flex-1 text-[12px] px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
      <button type="button" onClick={() => void enviar()} disabled={enviando || !txt.trim()} className="text-sm text-indigo-600 disabled:opacity-40 px-1">➤</button>
    </div>
  );
}

function NovaTarefaEnxuta({ rid, pessoas, podeVerTodas, autor, onClose }: { rid: string; pessoas: Pessoa[]; podeVerTodas: boolean; autor: { id: string; nome: string }; onClose: () => void }) {
  const [titulo, setTitulo] = useState("");
  const [responsavelId, setResponsavelId] = useState(podeVerTodas ? "" : autor.id);
  const [prazo, setPrazo] = useState("");
  const [prioridade, setPrioridade] = useState<TarefaPrioridade>("normal");
  const [salvando, setSalvando] = useState(false);
  const pessoasOrd = useMemo(() => [...pessoas].sort((a, b) => a.nome.localeCompare(b.nome)), [pessoas]);
  async function salvar() {
    if (!titulo.trim()) { alert("Dê um título."); return; }
    setSalvando(true);
    const respId = responsavelId || autor.id;
    const respNome = pessoasOrd.find(p => p.id === respId)?.nome || autor.nome;
    try {
      await criarTarefaOperacional({ rid, titulo: titulo.trim(), responsavelId: respId, responsavelNome: respNome, prazo: prazo || null, prioridade, origem: "manual", criadoPor: autor.id, criadoPorNome: autor.nome });
      onClose();
    } catch (e) { alert("Erro: " + (e instanceof Error ? e.message : String(e))); setSalvando(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="text-base font-bold text-gray-900 dark:text-gray-100">Nova tarefa</div>
        <input value={titulo} onChange={e => setTitulo(e.target.value)} autoFocus placeholder="O que precisa ser feito" className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
        {podeVerTodas && (
          <select value={responsavelId} onChange={e => setResponsavelId(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100">
            <option value="">— eu ({autor.nome}) —</option>
            {pessoasOrd.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        )}
        <div className="flex items-center gap-2">
          <input type="date" value={prazo} onChange={e => setPrazo(e.target.value)} className="flex-1 h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
          <select value={prioridade} onChange={e => setPrioridade(e.target.value as TarefaPrioridade)} className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100">
            <option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option>
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Cancelar</button>
          <button type="button" onClick={() => void salvar()} disabled={salvando} className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-50">{salvando ? "Criando…" : "Criar"}</button>
        </div>
      </div>
    </div>
  );
}
