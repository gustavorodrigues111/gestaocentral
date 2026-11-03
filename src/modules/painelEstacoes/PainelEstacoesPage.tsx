// Estações do Painel do Salão (master) — cadastra e CONFIGURA cada estação de
// parede: código read-only por restaurante, números de WhatsApp que ela mostra,
// usuários com acesso (allow-list pra agir) e ações permitidas. A estação de
// parede (rota /painel-estacao) usa o código; revogável aqui.
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { MonitorPlay, Plus, Trash2, Copy, Check, Power, X, Lock, Search } from "lucide-react";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useTodasPessoas } from "../../core/pessoas/PessoasContext";
import { PageContainer } from "../../core/ui/PageContainer";
import * as repo from "./estacoesRepo";
import { type EstacaoToken, ACOES_PADRAO } from "./estacoesRepo";

const INPUT = "w-full h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm";

function Copiavel({ texto, label }: { texto: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard?.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => {}); }}
      className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-medium max-w-full" title={`Copiar ${label}`}>
      {ok ? <Check size={13} className="text-emerald-600 shrink-0" /> : <Copy size={13} className="shrink-0" />}
      <span className="truncate font-mono">{texto}</span>
    </button>
  );
}

export function PainelEstacoesPage() {
  const { pessoa: me } = useAuth();
  const isMaster = !!me?.isMaster;
  const { restaurants } = useRestaurant();
  const pessoas = useTodasPessoas();
  const [estacoes, setEstacoes] = useState<EstacaoToken[]>([]);
  const [numeros, setNumeros] = useState<any[]>([]);
  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => { if (!isMaster) return; return repo.ouvirEstacoes(setEstacoes); }, [isMaster]);
  useEffect(() => { if (!isMaster) return; return onSnapshot(collection(db, "whatsappNumeros"), (s) => setNumeros(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {}); }, [isMaster]);

  if (!isMaster) {
    return <PageContainer><div className="max-w-md mx-auto py-20 text-center text-gray-500"><Lock size={40} className="mx-auto mb-3 text-gray-400" />Só o master configura as estações do painel.</div></PageContainer>;
  }

  function nova() {
    const e: EstacaoToken = { id: repo.gerarToken(), nome: "", restaurantId: "", restaurantNome: "", whatsappNumeroIds: [], usuariosIds: [], usuariosNomes: [], acoes: { ...ACOES_PADRAO }, ativo: true, criadoEm: new Date().toISOString(), criadoPor: me?.nome || me?.id || null };
    setEstacoes((p) => [e, ...p]); setEditId(e.id);
  }

  return (
    <PageContainer>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex items-center justify-center"><MonitorPlay size={18} /></div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold leading-tight">Estações do Painel</h1>
          <p className="text-xs text-gray-500">Telas de parede do salão · código read-only por restaurante</p>
        </div>
        <button className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-amber-600 text-white text-sm font-semibold" onClick={nova}><Plus size={16} /> Nova estação</button>
      </div>

      <div className="space-y-3 mt-3">
        {estacoes.length === 0 && <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">Nenhuma estação. Clique em <b>Nova estação</b>.</div>}
        {estacoes.map((e) => editId === e.id
          ? <Editor key={e.id} est={e} restaurants={restaurants} numeros={numeros} pessoas={pessoas} onCancel={() => { setEditId(null); if (!e.nome) setEstacoes((p) => p.filter((x) => x.id !== e.id)); }} onSaved={() => setEditId(null)} />
          : <Card key={e.id} est={e} onEdit={() => setEditId(e.id)} />)}
      </div>
    </PageContainer>
  );
}

function Card({ est, onEdit }: { est: EstacaoToken; onEdit: () => void }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://admin.planejamento.app";
  const acoes = est.acoes || ACOES_PADRAO;
  const acoesLabel = [acoes.whatsapp && "WhatsApp", acoes.checklist && "Checklists", acoes.freela && "Freelas"].filter(Boolean).join(" · ") || "só visualização";
  return (
    <div className={`rounded-2xl border p-4 ${est.ativo ? "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" : "border-amber-300/60 bg-amber-50/40 dark:bg-amber-900/10"}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold">{est.nome || "—"}</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">{est.restaurantNome}</span>
        {!est.ativo && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-semibold">revogada</span>}
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => void repo.toggleEstacao(est.id, !est.ativo)} className={`inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-semibold ${est.ativo ? "border border-gray-300 dark:border-gray-600" : "bg-emerald-600 text-white"}`}><Power size={13} /> {est.ativo ? "Revogar" : "Reativar"}</button>
          <button onClick={onEdit} className="inline-flex items-center h-8 px-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold">Configurar</button>
          <button onClick={() => { if (confirm("Excluir esta estação? O código para de funcionar.")) void repo.excluirEstacao(est.id); }} className="text-gray-400 hover:text-rose-600" title="Excluir"><Trash2 size={15} /></button>
        </div>
      </div>
      <div className="text-[12px] text-gray-500 mt-1">Ações: {acoesLabel} · {est.usuariosNomes?.length || 0} usuário(s) · {est.whatsappNumeroIds?.length ? `${est.whatsappNumeroIds.length} número(s)` : "todos os números"}</div>
      <div className="flex flex-wrap gap-2 mt-2">
        <Copiavel texto={est.id} label="código" />
        <Copiavel texto={`${origin}/painel-estacao?t=${est.id}`} label="link da estação" />
      </div>
    </div>
  );
}

function Editor({ est, restaurants, numeros, pessoas, onCancel, onSaved }: { est: EstacaoToken; restaurants: any[]; numeros: any[]; pessoas: any[]; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState<EstacaoToken>({ ...est, acoes: est.acoes || { ...ACOES_PADRAO } });
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);
  const set = (patch: Partial<EstacaoToken>) => setF((p) => ({ ...p, ...patch }));

  const numerosRest = useMemo(() => numeros.filter((n) => (n.restaurantIds || []).includes(f.restaurantId) && n.ativo !== false), [numeros, f.restaurantId]);
  const pessoasRest = useMemo(() => pessoas.filter((p) => (p.restaurantIds || []).includes(f.restaurantId)), [pessoas, f.restaurantId]);
  const usuariosSel = f.usuariosIds || [];
  const sugestoes = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return pessoasRest.filter((p) => !usuariosSel.includes(p.id) && (!q || (p.nome || "").toLowerCase().includes(q))).slice(0, 6);
  }, [pessoasRest, usuariosSel, busca]);

  function addUser(p: any) { set({ usuariosIds: [...usuariosSel, p.id], usuariosNomes: [...(f.usuariosNomes || []), { id: p.id, nome: p.nome }] }); setBusca(""); }
  function rmUser(id: string) { set({ usuariosIds: usuariosSel.filter((x) => x !== id), usuariosNomes: (f.usuariosNomes || []).filter((u) => u.id !== id) }); }
  function toggleNumero(id: string) { const cur = f.whatsappNumeroIds || []; set({ whatsappNumeroIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] }); }
  function setAcao(k: keyof NonNullable<EstacaoToken["acoes"]>, v: boolean) { set({ acoes: { ...(f.acoes || ACOES_PADRAO), [k]: v } }); }

  const podeSalvar = f.nome.trim().length > 0 && !!f.restaurantId;
  async function salvar() {
    setSalvando(true);
    const rest = restaurants.find((r) => r.id === f.restaurantId);
    await repo.criarEstacao({ ...f, nome: f.nome.trim(), restaurantNome: rest?.nome || f.restaurantNome || "Restaurante" });
    setSalvando(false); onSaved();
  }

  return (
    <div className="rounded-2xl border border-amber-300 dark:border-amber-800 bg-white dark:bg-gray-900 p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input className={INPUT} placeholder="Nome da estação (ex.: Parede do salão) *" value={f.nome} onChange={(e) => set({ nome: e.target.value })} />
        <select className={INPUT} value={f.restaurantId} onChange={(e) => set({ restaurantId: e.target.value, whatsappNumeroIds: [], usuariosIds: [], usuariosNomes: [] })}>
          <option value="">Restaurante… *</option>
          {restaurants.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
        </select>
      </div>

      {f.restaurantId && (
        <>
          {/* Números de WhatsApp */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Números de WhatsApp na estação <span className="normal-case text-gray-400">(nenhum = todos do restaurante)</span></div>
            {numerosRest.length === 0 ? <div className="text-sm text-gray-400 italic">Nenhum número de WhatsApp nesse restaurante.</div> : (
              <div className="flex flex-wrap gap-1.5">
                {numerosRest.map((n) => {
                  const on = (f.whatsappNumeroIds || []).includes(n.id);
                  return <button key={n.id} onClick={() => toggleNumero(n.id)} className="text-xs font-semibold px-2.5 py-1 rounded-full border" style={{ borderColor: on ? "#059669" : "", background: on ? "#05966922" : "", color: on ? "#059669" : "" }}>{n.nome || n.id}</button>;
                })}
              </div>
            )}
          </div>

          {/* Usuários com acesso (typeahead + chips) */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Usuários com acesso (podem agir pela estação)</div>
            {(f.usuariosNomes || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(f.usuariosNomes || []).map((u) => (
                  <span key={u.id} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800">{u.nome}<button onClick={() => rmUser(u.id)} className="text-gray-400 hover:text-rose-600"><X size={12} /></button></span>
                ))}
              </div>
            )}
            <div className="relative">
              <div className="flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 h-9">
                <Search size={14} className="text-gray-400" />
                <input className="flex-1 bg-transparent text-sm outline-none" placeholder="buscar pessoa pelo nome…" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </div>
              {busca.trim() && sugestoes.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
                  {sugestoes.map((p) => <button key={p.id} onClick={() => addUser(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800">{p.nome}</button>)}
                </div>
              )}
            </div>
          </div>

          {/* Ações permitidas */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Ações permitidas na estação</div>
            <div className="flex flex-wrap gap-3 text-sm">
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!f.acoes?.whatsapp} onChange={(e) => setAcao("whatsapp", e.target.checked)} /> Responder WhatsApp</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!f.acoes?.checklist} onChange={(e) => setAcao("checklist", e.target.checked)} /> Preencher checklist</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!f.acoes?.freela} onChange={(e) => setAcao("freela", e.target.checked)} /> Lançar/abrir freela</label>
            </div>
            <div className="text-[11px] text-gray-400 mt-1">As ações pedem "quem está agindo?" na parede (escolhe um dos usuários acima) e ficam registradas no nome da pessoa.</div>
          </div>
        </>
      )}

      <div className="flex items-center gap-2 pt-1">
        <label className="inline-flex items-center gap-2 text-sm mr-auto"><input type="checkbox" checked={f.ativo} onChange={(e) => set({ ativo: e.target.checked })} /> Ativa</label>
        <button className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-600 text-sm" onClick={onCancel}><X size={15} /> Cancelar</button>
        <button className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-amber-600 text-white text-sm font-semibold disabled:opacity-50" disabled={!podeSalvar || salvando} onClick={() => void salvar()}><Check size={15} /> {salvando ? "Salvando…" : "Salvar"}</button>
      </div>
    </div>
  );
}
