// Monitores do Bot Planejamento.app — liga uma CONVERSA/GRUPO de um número a
// uma ou mais SKILLS + destino (restaurante/projeto). Grava whatsappMonitores/
// {numeroId__waId}; o evolution-webhook lê isso e trata a conversa como bot
// (sem cair no atendimento humano). Inerte até existir.
import { useEffect, useMemo, useState } from "react";
import { Bot, Plus, Trash2, Check, Power } from "lucide-react";
import { collection, onSnapshot, doc, setDoc, deleteDoc, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { usePessoasAtivasLista } from "../../core/pessoas/PessoasContext";
import type { WhatsappMonitor, WhatsappMonitorModo, InvestProjeto } from "../../core/types";

const INPUT = "w-full h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm";
const BTN_P = "inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50";

type Numero = { id: string; nome?: string };
type Grupo = { waId: string; nome: string };
const MODOS: { v: WhatsappMonitorModo; label: string }[] = [
  { v: "silencioso", label: "Silencioso (só reage com emoji)" },
  { v: "confirma", label: "Confirma no grupo (✅)" },
  { v: "pergunta", label: "Confirma e pergunta no grupo" },
];
// Catálogo de SKILLS que o bot pode exercer num grupo. Novas skills entram aqui;
// `temConfigInvest` marca as que precisam de restaurante+projeto de investimento.
const SKILLS: { id: string; label: string; desc: string; temConfigInvest?: boolean }[] = [
  { id: "investimentos", label: "Lançar em Novos Investimentos", desc: "Lê comprovantes/gastos e lança como rascunho no projeto escolhido.", temConfigInvest: true },
];

export function MonitoresManager() {
  const { restaurants, activeRestaurant } = useRestaurant();
  const [numeros, setNumeros] = useState<Numero[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [monitores, setMonitores] = useState<WhatsappMonitor[]>([]);
  const [projetos, setProjetos] = useState<InvestProjeto[]>([]);

  // Form
  const [skillsSel, setSkillsSel] = useState<string[]>(["investimentos"]);
  const precisaInvest = skillsSel.some((s) => SKILLS.find((x) => x.id === s)?.temConfigInvest);
  const [numeroId, setNumeroId] = useState("");
  const [grupoWaId, setGrupoWaId] = useState("");
  const [buscaGrupo, setBuscaGrupo] = useState("");   // texto digitado na busca de grupo
  const [grupoAberto, setGrupoAberto] = useState(false); // dropdown de resultados visível
  const [restaurantId, setRestaurantId] = useState(activeRestaurant?.id || "");
  const [projetoId, setProjetoId] = useState("");
  const [modo, setModo] = useState<WhatsappMonitorModo>("silencioso");
  const [ocultar, setOcultar] = useState(true);          // esconder o grupo do Chat (atendimento)
  const [respPessoaId, setRespPessoaId] = useState("");  // responsável técnico (recebe dúvidas)
  const [respBusca, setRespBusca] = useState("");
  const [respAberto, setRespAberto] = useState(false);
  const [respWhats, setRespWhats] = useState("");        // WhatsApp do responsável (dúvidas no privado)
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);
  const pessoas = usePessoasAtivasLista();
  const pessoasFiltradas = useMemo(() => {
    const q = respBusca.trim().toLowerCase();
    return (q ? pessoas.filter((p) => p.nome.toLowerCase().includes(q)) : pessoas).slice(0, 20);
  }, [pessoas, respBusca]);

  useEffect(() => {
    const subs = [
      onSnapshot(collection(db, "whatsappNumeros"), (s) => setNumeros(s.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Numero))),
      onSnapshot(query(collection(db, "whatsappContatos"), where("ehGrupo", "==", true)), (s) =>
        setGrupos(s.docs.map((d) => { const x = d.data() as Record<string, unknown>; return { waId: String(x.waId || d.id), nome: String(x.nomeManual || x.nomeGrupo || "Grupo") }; }))),
      onSnapshot(collection(db, "whatsappMonitores"), (s) => setMonitores(s.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as WhatsappMonitor))),
    ];
    return () => subs.forEach((u) => u());
  }, []);

  // Projetos do restaurante escolhido (destino da skill investimentos).
  useEffect(() => {
    if (!restaurantId) return;
    return onSnapshot(query(collection(db, "investProjetos"), where("restaurantId", "==", restaurantId)), (s) =>
      setProjetos(s.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as InvestProjeto).filter((p) => p.ativo !== false)));
  }, [restaurantId]);
  // Só os projetos do restaurante atualmente selecionado (evita resíduo ao trocar).
  const projetosRest = projetos.filter((p) => p.restaurantId === restaurantId);

  const nomeNumero = (id: string) => numeros.find((n) => n.id === id)?.nome || id;
  const nomeGrupo = (waId: string) => grupos.find((g) => g.waId === waId)?.nome || waId;

  // Grupos que batem com a busca (por nome). Mostra todos quando o campo está vazio.
  const gruposFiltrados = useMemo(() => {
    const q = buscaGrupo.trim().toLowerCase();
    const base = q ? grupos.filter((g) => g.nome.toLowerCase().includes(q)) : grupos;
    return base.slice(0, 30);
  }, [grupos, buscaGrupo]);
  function escolherGrupo(g: Grupo) {
    setGrupoWaId(g.waId);
    setBuscaGrupo(g.nome);
    setGrupoAberto(false);
  }
  const nomeRest = (id: string) => restaurants.find((r) => r.id === id)?.nome || id;
  const nomeProj = useMemo(() => {
    const m: Record<string, string> = {};
    projetos.forEach((p) => { m[p.id] = p.nome; });
    return m;
  }, [projetos]);

  async function salvar() {
    setErro(""); setOk(false);
    if (skillsSel.length === 0) { setErro("Escolha ao menos uma função pro bot."); return; }
    if (!numeroId) { setErro("Escolha o número."); return; }
    if (!grupoWaId) { setErro("Escolha o grupo."); return; }
    if (precisaInvest && !restaurantId) { setErro("Escolha o restaurante."); return; }
    if (precisaInvest && !projetoId) { setErro("Escolha o projeto de destino."); return; }
    const id = `${numeroId}__${grupoWaId}`;
    const iso = new Date().toISOString();
    const mon: WhatsappMonitor = {
      id, numeroId, waId: grupoWaId, nome: nomeGrupo(grupoWaId),
      skills: skillsSel,
      restaurantId: precisaInvest ? restaurantId : (restaurantId || ""),
      projetoId: precisaInvest ? projetoId : null,
      modo, ocultarDoInbox: ocultar,
      responsavelPessoaId: respPessoaId || null,
      responsavelWhatsapp: respWhats.replace(/\D/g, "") || null,
      exclusivo: true, ativo: true, criadoEm: iso, atualizadoEm: iso,
    };
    setSalvando(true);
    try {
      await setDoc(doc(db, "whatsappMonitores", id), sanitizeForFirestore(mon), { merge: true });
      setOk(true); setTimeout(() => setOk(false), 2500);
      setGrupoWaId(""); setBuscaGrupo(""); setProjetoId("");
      setRespPessoaId(""); setRespBusca(""); setRespWhats("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally { setSalvando(false); }
  }

  async function toggleAtivo(m: WhatsappMonitor) {
    await setDoc(doc(db, "whatsappMonitores", m.id), sanitizeForFirestore({ ativo: !m.ativo, atualizadoEm: new Date().toISOString() }), { merge: true });
  }
  async function excluir(m: WhatsappMonitor) {
    if (!window.confirm(`Remover o monitor do grupo "${m.nome || m.waId}"? O grupo volta ao atendimento normal.`)) return;
    await deleteDoc(doc(db, "whatsappMonitores", m.id));
  }

  return (
    <div className="space-y-4">
      {/* Form de novo monitor */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 inline-flex items-center gap-1.5"><Plus size={13} /> Novo grupo monitorado</div>
        {erro && <div className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">{erro}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">Número (instância)
            <select className={INPUT} value={numeroId} onChange={(e) => setNumeroId(e.target.value)}>
              <option value="">Escolha o número…</option>
              {numeros.map((n) => <option key={n.id} value={n.id}>{n.nome || n.id}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500">Grupo
            <div className="relative">
              <input
                className={INPUT}
                value={buscaGrupo}
                placeholder="Buscar grupo pelo nome…"
                onChange={(e) => { setBuscaGrupo(e.target.value); setGrupoWaId(""); setGrupoAberto(true); }}
                onFocus={() => setGrupoAberto(true)}
                onBlur={() => setTimeout(() => setGrupoAberto(false), 150)}
              />
              {grupoAberto && (
                <div className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
                  {gruposFiltrados.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">Nenhum grupo encontrado.</div>}
                  {gruposFiltrados.map((g) => (
                    <button type="button" key={g.waId}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 dark:hover:bg-emerald-900/20 ${g.waId === grupoWaId ? "bg-emerald-50 dark:bg-emerald-900/20 font-medium" : ""}`}
                      onMouseDown={(e) => { e.preventDefault(); escolherGrupo(g); }}>
                      {g.nome}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </label>
        </div>
        {grupos.length === 0 && <div className="text-[11px] text-amber-600">Nenhum grupo visto ainda. Adicione o número ao grupo e mande uma mensagem lá — ele aparece aqui.</div>}

        {/* O que o bot FAZ nesse grupo — uma ou mais funções (skills). */}
        <div>
          <div className="text-xs text-gray-500 mb-1">O que o bot faz aqui</div>
          <div className="space-y-1.5">
            {SKILLS.map((sk) => {
              const on = skillsSel.includes(sk.id);
              return (
                <label key={sk.id} className={`flex items-start gap-2 rounded-lg border p-2 cursor-pointer transition-colors ${on ? "border-emerald-400 bg-emerald-50/50 dark:border-emerald-700 dark:bg-emerald-900/15" : "border-gray-200 dark:border-gray-700"}`}>
                  <input type="checkbox" className="h-4 w-4 mt-0.5 accent-emerald-600" checked={on}
                    onChange={(e) => setSkillsSel((prev) => e.target.checked ? [...prev, sk.id] : prev.filter((x) => x !== sk.id))} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-gray-800 dark:text-gray-100">{sk.label}</div>
                    <div className="text-[11px] text-gray-500">{sk.desc}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Config da skill de investimentos (só quando selecionada). */}
        {precisaInvest && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2.5 space-y-2 bg-gray-50/40 dark:bg-gray-800/20">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Destino · Novos Investimentos</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-xs text-gray-500">Restaurante
                <select className={INPUT} value={restaurantId} onChange={(e) => { setRestaurantId(e.target.value); setProjetoId(""); }}>
                  <option value="">Escolha…</option>
                  {restaurants.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-500">Projeto
                <select className={INPUT} value={projetoId} disabled={!restaurantId} onChange={(e) => setProjetoId(e.target.value)}>
                  <option value="">Escolha…</option>
                  {projetosRest.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </label>
            </div>
            {restaurantId && projetosRest.length === 0 && <div className="text-[11px] text-amber-600">Esse restaurante não tem projeto de investimento ativo. Crie um no módulo Novos Investimentos.</div>}
          </div>
        )}
        <label className="text-xs text-gray-500 block">Comportamento no grupo
          <select className={INPUT} value={modo} onChange={(e) => setModo(e.target.value as WhatsappMonitorModo)}>
            {MODOS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
          </select>
        </label>
        {/* Responsável técnico: recebe dúvidas/divergências no privado (F2) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">Responsável técnico (dúvidas)
            <div className="relative">
              <input className={INPUT} value={respBusca} placeholder="Buscar pessoa…"
                onChange={(e) => { setRespBusca(e.target.value); setRespPessoaId(""); setRespAberto(true); }}
                onFocus={() => setRespAberto(true)} onBlur={() => setTimeout(() => setRespAberto(false), 150)} />
              {respAberto && (
                <div className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
                  {pessoasFiltradas.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">Nenhuma pessoa.</div>}
                  {pessoasFiltradas.map((p) => (
                    <button type="button" key={p.id}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 dark:hover:bg-emerald-900/20 ${p.id === respPessoaId ? "bg-emerald-50 dark:bg-emerald-900/20 font-medium" : ""}`}
                      onMouseDown={(e) => { e.preventDefault(); setRespPessoaId(p.id); setRespBusca(p.nome); setRespAberto(false); }}>
                      {p.nome}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </label>
          <label className="text-xs text-gray-500">WhatsApp do responsável
            <input className={INPUT} value={respWhats} placeholder="(91) 99999-9999"
              inputMode="tel" onChange={(e) => setRespWhats(e.target.value)} />
          </label>
        </div>
        <p className="text-[11px] text-gray-400 -mt-1">Dúvidas e divergências o bot manda no <b>privado</b> dessa pessoa (e um aviso na Central), sem poluir o grupo.</p>
        <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={ocultar} onChange={(e) => setOcultar(e.target.checked)} />
          Ocultar este grupo do Chat (atendimento)
          <span className="text-[11px] text-gray-400">· desmarque se atendentes do número precisam ver o grupo</span>
        </label>
        <button className={`${BTN_P} w-full`} disabled={salvando} onClick={() => void salvar()}>
          {ok ? <><Check size={16} /> Monitor salvo</> : salvando ? "Salvando…" : <><Bot size={16} /> Monitorar este grupo</>}
        </button>
        <div className="text-[11px] text-gray-400">Comprovantes e gastos mandados no grupo viram <b>rascunho</b> em Novos Investimentos (o bot reage com ✅). Confira os rascunhos no módulo.</div>
      </div>

      {/* Lista de monitores */}
      <div className="space-y-2">
        {monitores.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-700 p-2">
            <div className="min-w-0 text-sm">
              <div className="font-medium truncate inline-flex items-center gap-1.5">
                <Bot size={14} className={m.ativo ? "text-emerald-600" : "text-gray-400"} /> {m.nome || m.waId}
                {!m.ativo && <span className="text-[10px] text-gray-400">(pausado)</span>}
              </div>
              <div className="text-xs text-gray-500 truncate">
                {nomeNumero(m.numeroId)} · {nomeRest(m.restaurantId)}{m.projetoId ? ` / ${nomeProj[m.projetoId] || m.projetoId}` : ""} · {MODOS.find((x) => x.v === m.modo)?.label.split(" ")[0] || m.modo}{m.ocultarDoInbox === false ? " · visível no Chat" : ""}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button className="p-1.5 text-gray-400 hover:text-emerald-600" title={m.ativo ? "Pausar" : "Ativar"} onClick={() => void toggleAtivo(m)}><Power size={15} /></button>
              <button className="p-1.5 text-gray-400 hover:text-rose-600" title="Remover" onClick={() => void excluir(m)}><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
        {monitores.length === 0 && <div className="text-xs text-gray-400 italic px-1">Nenhum grupo monitorado ainda.</div>}
      </div>
    </div>
  );
}
