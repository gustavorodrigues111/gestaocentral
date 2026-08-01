// Agentes de IA (SÓ MASTER) — F1a: gestão dos agentes (DP e Financeiro).
// Cria/edita persona, liga ferramentas do catálogo, define escopo de entidades.
// O motor de chat + execução de ferramentas (loop tool-use no api/agente.ts)
// entra no F1b. Escrita sempre em modo confirmação; permissão herda de Pessoas.
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc, addDoc, query, where, writeBatch } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { authHeader } from "../../core/firebase/idToken";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import { fmtBR } from "../../core/utils/date";
import type { AgenteIA, AgenteLog } from "../../core/types";
import { CATALOGO, DOMINIO_META, type AgenteDominio } from "./catalogo";

const uid = () => `ag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const toolsPadrao = (tipo: AgenteDominio): Record<string, boolean> =>
  Object.fromEntries(CATALOGO[tipo].map(f => [f.key, f.tipo === "read"]));

export function AgentesPage() {
  const { pessoa } = useAuth();
  const { restaurants } = useRestaurant();
  const [aba, setAba] = useState<"agentes" | "historico">("agentes");
  const [agentes, setAgentes] = useState<AgenteIA[]>([]);
  const [logs, setLogs] = useState<AgenteLog[]>([]);
  const [editando, setEditando] = useState<AgenteIA | null>(null);
  const [conversando, setConversando] = useState<AgenteIA | null>(null);

  useEffect(() => {
    const u = onSnapshot(collection(db, "agentesIA"), s => setAgentes(s.docs.map(d => ({ id: d.id, ...d.data() }) as AgenteIA)));
    return () => u();
  }, []);
  useEffect(() => {
    if (aba !== "historico") return;
    const u = onSnapshot(collection(db, "agenteLogs"), s => setLogs(s.docs.map(d => ({ id: d.id, ...d.data() }) as AgenteLog).sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || "")).slice(0, 200)));
    return () => u();
  }, [aba]);

  async function salvar(a: AgenteIA) {
    await setDoc(doc(db, "agentesIA", a.id), sanitizeForFirestore({ ...a, atualizadoEm: new Date().toISOString() }));
    setEditando(null);
  }
  async function excluir(id: string) {
    if (!confirm("Excluir este agente? A configuração e o histórico de conversa dele somem.")) return;
    await deleteDoc(doc(db, "agentesIA", id));
  }
  function novo(tipo: AgenteDominio) {
    const m = DOMINIO_META[tipo];
    setEditando({ id: uid(), nome: `Agente ${m.label}`, tipo, systemPrompt: m.promptPadrao, tools: toolsPadrao(tipo), entidades: "todas", modoEscrita: "confirmar", ativo: true, criadoEm: new Date().toISOString(), criadoPor: pessoa?.id || null });
  }
  async function seed() {
    const agora = new Date().toISOString();
    for (const tipo of ["dp", "financeiro", "cardapio"] as AgenteDominio[]) {
      if (agentes.some(a => a.tipo === tipo)) continue;
      const m = DOMINIO_META[tipo];
      await setDoc(doc(db, "agentesIA", uid()), sanitizeForFirestore({ nome: `Agente ${m.label}`, tipo, systemPrompt: m.promptPadrao, tools: toolsPadrao(tipo), entidades: "todas", modoEscrita: "confirmar", ativo: true, criadoEm: agora, criadoPor: pessoa?.id || null } as Omit<AgenteIA, "id">));
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-3">
        <button type="button" onClick={() => setAba("agentes")} className={`text-sm font-medium pb-1.5 border-b-2 ${aba === "agentes" ? "border-indigo-600 text-indigo-600 dark:text-indigo-300" : "border-transparent text-gray-500"}`}>Agentes</button>
        <button type="button" onClick={() => setAba("historico")} className={`text-sm font-medium pb-1.5 border-b-2 ${aba === "historico" ? "border-indigo-600 text-indigo-600 dark:text-indigo-300" : "border-transparent text-gray-500"}`}>Histórico</button>
      </div>

      {aba === "agentes" ? (
        <>
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <p className="text-xs text-gray-500 max-w-lg">Agentes consultam dados da plataforma e — com <b>confirmação</b> — alteram. O acesso de cada um herda as permissões de quem fala com ele. O chat e a resposta no WhatsApp chegam no próximo passo.</p>
            <div className="flex gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => novo("dp")}>🧑‍💼 Novo DP</Button>
              <Button size="sm" variant="secondary" onClick={() => novo("financeiro")}>💰 Novo Financeiro</Button>
              <Button size="sm" variant="secondary" onClick={() => novo("cardapio")}>🍽️ Novo Cardápio</Button>
            </div>
          </div>

          {agentes.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
              <div className="text-4xl mb-2">🤖</div>
              <p className="text-sm text-gray-500 mb-3">Nenhum agente ainda. Crie os dois padrão (DP + Financeiro) pra começar.</p>
              <Button onClick={() => void seed()}>Criar agentes padrão</Button>
            </div>
          ) : (
            <div className="space-y-2">
              {agentes.sort((a, b) => a.tipo.localeCompare(b.tipo)).map(a => {
                const cat = CATALOGO[a.tipo];
                const ligadas = cat.filter(f => a.tools?.[f.key]).length;
                const escritas = cat.filter(f => f.tipo === "write" && a.tools?.[f.key]).length;
                return (
                  <div key={a.id} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 flex items-center justify-between gap-3">
                    <button type="button" onClick={() => a.ativo ? setConversando(a) : setEditando(a)} className="min-w-0 text-left flex-1">
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">{DOMINIO_META[a.tipo].icon} {a.nome}{!a.ativo && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800">pausado</span>}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">{ligadas} ferramenta(s) · {escritas > 0 ? `${escritas} de escrita (confirmação)` : "só leitura"} · {a.entidades === "todas" ? "todas as entidades" : `${(a.entidades as string[]).length} entidade(s)`}</div>
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {a.ativo && <Button size="sm" onClick={() => setConversando(a)}>💬 Conversar</Button>}
                      <button type="button" onClick={() => setEditando(a)} title="Configurar" className="w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center">⚙</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div>
          {logs.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">Sem atividade ainda. Aqui vai aparecer cada consulta e alteração que os agentes fizerem.</p>
          ) : (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
              {logs.map(l => (
                <div key={l.id} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full mr-1.5 ${l.tipo === "write" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`}>{l.tipo === "write" ? "escrita" : "leitura"}</span>
                    <span className="text-gray-800 dark:text-gray-200">{l.tool}</span>
                    {l.resumo && <span className="text-gray-400"> · {l.resumo}</span>}
                  </div>
                  <span className="text-[11px] text-gray-400 whitespace-nowrap">{l.pessoaNome || "—"} · {l.criadoEm ? fmtBR(l.criadoEm.slice(0, 10)) : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {editando && (
        <AgenteEditor agente={editando} restaurants={restaurants} onClose={() => setEditando(null)} onSalvar={salvar} onExcluir={excluir} />
      )}
      {conversando && (
        <AgenteChat agente={conversando} pessoaId={pessoa?.id} pessoaNome={pessoa?.nome} onClose={() => setConversando(null)} onConfig={() => { setEditando(conversando); setConversando(null); }} />
      )}
    </div>
  );
}

type ChatMsg = { id: string; role: "user" | "assistant"; texto: string; tools?: { tool: string; resumo: string }[]; criadoEm: string };

function AgenteChat({ agente, pessoaId, pessoaNome, onClose, onConfig }: { agente: AgenteIA; pessoaId?: string; pessoaNome?: string; onClose: () => void; onConfig: () => void }) {
  // Uma conversa contínua por (agente, pessoa). Persiste em agenteMensagens.
  const conversaId = `${agente.id}__${pessoaId || "anon"}`;
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const fimRef = useRef<HTMLDivElement | null>(null);

  // Carrega e mantém a conversa ao vivo (ordena no cliente — sem índice composto).
  useEffect(() => {
    const q = query(collection(db, "agenteMensagens"), where("conversaId", "==", conversaId));
    const u = onSnapshot(q, s => setMsgs(
      s.docs.map(d => ({ id: d.id, ...(d.data() as Omit<ChatMsg, "id">) }))
        .sort((a, b) => (a.criadoEm || "").localeCompare(b.criadoEm || ""))
    ));
    return () => u();
  }, [conversaId]);
  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length, enviando]);

  async function persistir(role: "user" | "assistant", texto: string, tools?: { tool: string; resumo: string }[]) {
    await addDoc(collection(db, "agenteMensagens"), {
      agenteId: agente.id, conversaId, restaurantId: null, role, texto,
      pessoaId: pessoaId || null, canal: "app", tools: tools || null,
      criadoEm: new Date().toISOString(),
    });
  }
  async function limparConversa() {
    if (!confirm("Apagar toda esta conversa? Não dá pra desfazer.")) return;
    const batch = writeBatch(db);
    for (const m of msgs) batch.delete(doc(db, "agenteMensagens", m.id));
    await batch.commit();
  }

  async function enviar() {
    const m = texto.trim();
    if (!m || enviando) return;
    setErro(""); setTexto("");
    const historico = msgs.map(x => ({ role: x.role, texto: x.texto }));
    setEnviando(true);
    try {
      await persistir("user", m);
      const r = await fetch("/api/agente", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ agenteId: agente.id, mensagem: m, historico, pessoaNome }) });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || "Falha na resposta."); await persistir("assistant", "⚠️ " + (j.error || "Erro.")); return; }
      await persistir("assistant", j.resposta || "(sem resposta)", j.toolCalls);
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro de rede."); }
    finally { setEnviando(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{DOMINIO_META[agente.tipo].icon} {agente.nome}</div>
          <div className="flex items-center gap-1">
            {msgs.length > 0 && <button type="button" onClick={() => void limparConversa()} title="Limpar conversa" className="w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center">🗑</button>}
            <button type="button" onClick={onConfig} title="Configurar" className="w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center">⚙</button>
            <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center">✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {msgs.length === 0 && (
            <div className="text-center text-xs text-gray-400 py-8">
              <div className="text-3xl mb-2">{DOMINIO_META[agente.tipo].icon}</div>
              Pergunte algo. Ele consulta os dados da plataforma e responde — por enquanto só leitura.
              <div className="mt-2 text-[11px]">Ex: {agente.tipo === "financeiro" ? "“Quais contas fixas vencem em julho?”" : "“Quem está em período de experiência este mês?”"}</div>
            </div>
          )}
          {msgs.map(m => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-indigo-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200"}`}>
                {m.texto}
                {m.tools && m.tools.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {m.tools.map((t, k) => <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200/70 dark:bg-gray-700/70 text-gray-500 dark:text-gray-400">🔎 {t.tool} · {t.resumo}</span>)}
                  </div>
                )}
              </div>
            </div>
          ))}
          {enviando && <div className="text-xs text-gray-400">consultando…</div>}
          {erro && <div className="text-xs text-rose-600">{erro}</div>}
          <div ref={fimRef} />
        </div>

        <div className="p-3 border-t border-gray-100 dark:border-gray-800 flex items-end gap-2">
          <textarea value={texto} onChange={e => setTexto(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }} rows={1} placeholder="Escreva uma pergunta…" className="flex-1 resize-none text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 max-h-28" />
          <Button disabled={enviando || !texto.trim()} onClick={() => void enviar()}>{enviando ? "…" : "Enviar"}</Button>
        </div>
      </div>
    </div>
  );
}

function AgenteEditor({ agente, restaurants, onClose, onSalvar, onExcluir }: {
  agente: AgenteIA; restaurants: { id: string; nome?: string }[];
  onClose: () => void; onSalvar: (a: AgenteIA) => Promise<void>; onExcluir: (id: string) => Promise<void>;
}) {
  const [a, setA] = useState<AgenteIA>(agente);
  const [busy, setBusy] = useState(false);
  const cat = CATALOGO[a.tipo];
  const reads = cat.filter(f => f.tipo === "read");
  const writes = cat.filter(f => f.tipo === "write");
  const todas = a.entidades === "todas";
  const sel = useMemo(() => new Set(todas ? [] : (a.entidades as string[])), [a.entidades, todas]);
  const setTool = (key: string, v: boolean) => setA(p => ({ ...p, tools: { ...p.tools, [key]: v } }));
  const toggleEnt = (rid: string) => setA(p => {
    const cur = new Set(p.entidades === "todas" ? [] : (p.entidades as string[]));
    cur.has(rid) ? cur.delete(rid) : cur.add(rid);
    return { ...p, entidades: [...cur] };
  });
  const inp = "w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5";

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg max-h-[88vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center">✕</button>
        <div className="text-[11px] font-medium text-gray-400 mb-1">{DOMINIO_META[a.tipo].icon} Agente de {DOMINIO_META[a.tipo].label}</div>

        <label className="block text-xs font-semibold text-gray-500 mb-1">Nome</label>
        <input value={a.nome} onChange={e => setA({ ...a, nome: e.target.value })} className={inp + " mb-3"} />

        <label className="block text-xs font-semibold text-gray-500 mb-1">Instruções (persona)</label>
        <textarea value={a.systemPrompt || ""} onChange={e => setA({ ...a, systemPrompt: e.target.value })} rows={4} className={inp + " mb-3 resize-y"} />

        <div className="text-xs font-semibold text-gray-500 mb-1.5">🔎 Ferramentas de leitura</div>
        <div className="space-y-1 mb-3">
          {reads.map(f => (
            <label key={f.key} className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={!!a.tools?.[f.key]} onChange={e => setTool(f.key, e.target.checked)} className="mt-0.5 w-4 h-4" />
              <span><span className="text-gray-800 dark:text-gray-200">{f.label}</span> <span className="text-[11px] text-gray-400">— {f.desc}</span></span>
            </label>
          ))}
        </div>

        <div className="text-xs font-semibold text-gray-500 mb-1.5">✏️ Ferramentas de escrita <span className="text-[10px] font-normal text-amber-600">(sempre pedem confirmação)</span></div>
        <div className="space-y-1 mb-3">
          {writes.map(f => (
            <label key={f.key} className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={!!a.tools?.[f.key]} onChange={e => setTool(f.key, e.target.checked)} className="mt-0.5 w-4 h-4 accent-amber-500" />
              <span><span className="text-gray-800 dark:text-gray-200">{f.label}</span> <span className="text-[11px] text-gray-400">— {f.desc}</span></span>
            </label>
          ))}
        </div>

        <div className="text-xs font-semibold text-gray-500 mb-1.5">🏢 Entidades no escopo</div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button type="button" onClick={() => setA({ ...a, entidades: "todas" })} className={`text-xs px-2.5 py-1 rounded-full border ${todas ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/25 dark:text-indigo-300" : "border-gray-200 text-gray-500 dark:border-gray-700"}`}>Todas</button>
          {restaurants.map(r => (
            <button key={r.id} type="button" onClick={() => toggleEnt(r.id)} className={`text-xs px-2.5 py-1 rounded-full border ${sel.has(r.id) ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/25 dark:text-indigo-300" : "border-gray-200 text-gray-500 dark:border-gray-700"}`}>{r.nome || r.id}</button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm mb-4 cursor-pointer">
          <input type="checkbox" checked={a.ativo} onChange={e => setA({ ...a, ativo: e.target.checked })} className="w-4 h-4" />
          <span className="text-gray-700 dark:text-gray-300">Agente ativo</span>
        </label>

        <div className="flex items-center justify-between gap-2">
          <Button variant="danger" size="sm" disabled={busy} onClick={() => void onExcluir(a.id)}>Excluir</Button>
          <Button disabled={busy || !a.nome.trim()} onClick={async () => { setBusy(true); try { await onSalvar(a); } finally { setBusy(false); } }}>{busy ? "…" : "Salvar"}</Button>
        </div>
      </div>
    </div>
  );
}
