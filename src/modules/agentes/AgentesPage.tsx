// Agentes de IA (SÓ MASTER) — F1a: gestão dos agentes (DP e Financeiro).
// Cria/edita persona, liga ferramentas do catálogo, define escopo de entidades.
// O motor de chat + execução de ferramentas (loop tool-use no api/agente.ts)
// entra no F1b. Escrita sempre em modo confirmação; permissão herda de Pessoas.
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
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
    for (const tipo of ["dp", "financeiro"] as AgenteDominio[]) {
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
                  <button key={a.id} type="button" onClick={() => setEditando(a)} className="w-full text-left rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 flex items-center justify-between gap-3 hover:shadow-sm transition-shadow">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">{DOMINIO_META[a.tipo].icon} {a.nome}{!a.ativo && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800">pausado</span>}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">{ligadas} ferramenta(s) · {escritas > 0 ? `${escritas} de escrita (confirmação)` : "só leitura"} · {a.entidades === "todas" ? "todas as entidades" : `${(a.entidades as string[]).length} entidade(s)`}</div>
                    </div>
                    <span className="text-gray-300">›</span>
                  </button>
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
