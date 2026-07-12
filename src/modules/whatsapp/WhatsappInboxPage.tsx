// Caixa de entrada do WhatsApp da plataforma. Mostra as conversas recebidas
// (whatsappMensagens, gravadas pelo webhook) e permite responder — texto livre
// funciona dentro da janela de 24h da última mensagem da pessoa; fora disso a
// Meta exige template. Número é único da plataforma (não por restaurante).
//
// Cada conversa (waId) pode ser vinculada a uma Pessoa (auto-match pelo número
// cadastrado) e a um restaurante, além de receber tags. Isso permite dividir a
// caixa por restaurante e filtrar por tag. Metadados em whatsappContatos/{waId}
// e catálogo de tags em whatsappTags.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { authHeader } from "../../core/firebase/idToken";
import { Button } from "../../core/ui/Button";
import { Modal } from "../../core/ui/Modal";
import { WhatsappTemplatesTab } from "./WhatsappTemplatesTab";
import type { Pessoa, WhatsappTag, WhatsappContato, WhatsappNumero } from "../../core/types";

type Msg = { id: string; waId: string; nome?: string | null; direcao: "in" | "out"; tipo?: string; texto?: string; timestamp?: string; recebidoEm?: string; lido?: boolean; autorNome?: string | null; numeroId?: string };

const hhmm = (iso?: string) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
const soDig = (s?: string | null) => (s || "").replace(/\D/g, "");
const foneBonito = (wa: string) => { const d = soDig(wa); const n = d.startsWith("55") ? d.slice(2) : d; return n.length >= 10 ? `+55 ${n.slice(0, 2)} ${n.slice(2, n.length - 4)}-${n.slice(-4)}` : wa; };
// Chave de comparação que ignora DDI 55 e o 9º dígito de celular (DDD + 8 últimos).
function foneKey(raw?: string | null): string {
  let d = soDig(raw);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : d;
}

const PALETA = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#ef4444", "#0ea5e9", "#8b5cf6", "#64748b"];

export function WhatsappInboxPage({ modo = "completo" }: { modo?: "conversas" | "completo" } = {}) {
  const embutido = modo === "conversas";
  const { pessoa: me } = useAuth();
  const { rid } = useParams<{ rid: string }>();
  const { restaurants } = useRestaurant();
  const isMaster = !!me?.isMaster;
  const { can } = useCanAcao(rid || "");
  const podeVer = isMaster || can("whatsappInbox", "ver");
  const podeResponder = isMaster || can("whatsappInbox", "responder");
  const podeVincular = isMaster || can("whatsappInbox", "vincular");
  const podeTags = isMaster || can("whatsappInbox", "gerenciarTags");
  const podeConfigNum = isMaster || can("whatsappInbox", "configurar");

  const [numeros, setNumeros] = useState<WhatsappNumero[]>([]);
  const [numeroSel, setNumeroSel] = useState<string | null>(null);
  const [gerNumeros, setGerNumeros] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [contatos, setContatos] = useState<Record<string, WhatsappContato>>({});
  const [tags, setTags] = useState<WhatsappTag[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [resposta, setResposta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [filtroRest, setFiltroRest] = useState<string>("all"); // "all" | rid | "none"
  const [filtroTag, setFiltroTag] = useState<string | null>(null);
  const [detalhes, setDetalhes] = useState(false);
  const [gerenciarTags, setGerenciarTags] = useState(false);
  const [tab, setTab] = useState<"conversas" | "templates">("conversas");

  const ridsKey = restaurants.map(r => r.id).join(",");
  const restNome = useMemo(() => Object.fromEntries(restaurants.map(r => [r.id, r.nome])), [restaurants]);

  // ── Loads ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const u = onSnapshot(query(collection(db, "whatsappMensagens"), orderBy("timestamp", "asc")), snap =>
      setMsgs(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Msg)));
    return () => u();
  }, []);

  useEffect(() => {
    const u = onSnapshot(collection(db, "whatsappNumeros"), snap =>
      setNumeros(snap.docs.map(d => ({ id: d.id, ...d.data() }) as WhatsappNumero).filter(n => n.ativo !== false)));
    return () => u();
  }, []);

  useEffect(() => {
    const base = collection(db, "pessoas");
    const rids = ridsKey ? ridsKey.split(",").slice(0, 10) : [];
    const q = isMaster ? base : (rids.length ? query(base, where("restaurantIds", "array-contains-any", rids)) : null);
    if (!q) { setPessoas([]); return; }
    const u = onSnapshot(q, snap => setPessoas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa)));
    return () => u();
  }, [isMaster, ridsKey]);

  useEffect(() => {
    const u = onSnapshot(collection(db, "whatsappContatos"), snap => {
      const m: Record<string, WhatsappContato> = {};
      snap.docs.forEach(d => { m[d.id] = { id: d.id, ...d.data() } as WhatsappContato; });
      setContatos(m);
    });
    return () => u();
  }, []);

  useEffect(() => {
    const u = onSnapshot(collection(db, "whatsappTags"), snap =>
      setTags(snap.docs.map(d => ({ id: d.id, ...d.data() }) as WhatsappTag).sort((a, b) => a.nome.localeCompare(b.nome))));
    return () => u();
  }, []);

  // ── Índices ────────────────────────────────────────────────────────────
  const pessoaById = useMemo(() => Object.fromEntries(pessoas.map(p => [p.id, p])), [pessoas]);
  const pessoaByFone = useMemo(() => {
    const m: Record<string, Pessoa> = {};
    for (const p of pessoas) { const k = foneKey(p.whatsapp); if (k && !m[k]) m[k] = p; }
    return m;
  }, [pessoas]);
  const tagById = useMemo(() => Object.fromEntries(tags.map(t => [t.id, t])), [tags]);

  // Resolve Pessoa vinculada (manual tem prioridade sobre auto-match).
  function pessoaDaConversa(waId: string): Pessoa | null {
    const c = contatos[waId];
    if (c?.pessoaId) return pessoaById[c.pessoaId] || null;
    return pessoaByFone[foneKey(waId)] || null;
  }
  // Resolve restaurantes (override manual multi → herda todos os da Pessoa).
  function restsDaConversa(waId: string): string[] {
    const c = contatos[waId];
    if (c?.restaurantIds != null) return c.restaurantIds;
    if (c?.restaurantId) return [c.restaurantId];   // legado single
    const p = pessoaDaConversa(waId);
    return p?.restaurantIds || [];
  }
  // Se o contato ainda não tem override manual (herda da Pessoa).
  function restHerdado(waId: string): boolean {
    const c = contatos[waId];
    return c?.restaurantIds == null && !c?.restaurantId;
  }

  // ── Números acessíveis (por atribuição de usuário) + número selecionado ────
  // Master vê todos; os demais só os números em que estão em usuariosIds.
  const numerosVisiveis = isMaster ? numeros : numeros.filter(n => (n.usuariosIds || []).includes(me?.id || ""));
  useEffect(() => {
    if (numerosVisiveis.length === 0) { if (numeroSel !== null) setNumeroSel(null); return; }
    if (!numeroSel || !numerosVisiveis.some(n => n.id === numeroSel)) setNumeroSel(numerosVisiveis[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numerosVisiveis.map(n => n.id).join(","), numeroSel]);
  // Só as mensagens do número selecionado.
  const msgsDoNumero = useMemo(() => msgs.filter(m => m.numeroId === numeroSel), [msgs, numeroSel]);

  // ── Conversas agrupadas ──────────────────────────────────────────────────
  const conversas = useMemo(() => {
    const m = new Map<string, { waId: string; nome?: string | null; ultima: Msg; naoLidas: number }>();
    for (const msg of msgsDoNumero) {
      const c = m.get(msg.waId) || { waId: msg.waId, nome: msg.nome, ultima: msg, naoLidas: 0 };
      c.ultima = msg; if (msg.nome) c.nome = msg.nome;
      m.set(msg.waId, c);
    }
    for (const msg of msgsDoNumero) if (msg.direcao === "in" && !msg.lido) { const c = m.get(msg.waId); if (c) c.naoLidas++; }
    return [...m.values()].sort((a, b) => (b.ultima.timestamp || "").localeCompare(a.ultima.timestamp || ""));
  }, [msgsDoNumero]);

  const nomeConversa = (waId: string, waNome?: string | null) =>
    contatos[waId]?.nomeManual || pessoaDaConversa(waId)?.nome || waNome || foneBonito(waId);

  // Filtro por restaurante + tag.
  const conversasFiltradas = useMemo(() => conversas.filter(c => {
    if (filtroRest !== "all") {
      const rs = restsDaConversa(c.waId);
      if (filtroRest === "none" ? rs.length > 0 : !rs.includes(filtroRest)) return false;
    }
    if (filtroTag) { if (!(contatos[c.waId]?.tagIds || []).includes(filtroTag)) return false; }
    return true;
  }), [conversas, filtroRest, filtroTag, contatos, pessoas]);

  const thread = useMemo(() => msgsDoNumero.filter(x => x.waId === sel), [msgsDoNumero, sel]);
  const nomeSel = sel ? nomeConversa(sel, conversas.find(c => c.waId === sel)?.nome) : "";

  // Marca recebidas como lidas ao abrir.
  useEffect(() => {
    if (!sel) return;
    for (const m of msgs) if (m.waId === sel && m.direcao === "in" && !m.lido) void updateDoc(doc(db, "whatsappMensagens", m.id), { lido: true }).catch(() => {});
  }, [sel, msgs]);

  // ── Writers ──────────────────────────────────────────────────────────────
  async function salvarContato(waId: string, patch: Partial<WhatsappContato>) {
    await setDoc(doc(db, "whatsappContatos", waId), sanitizeForFirestore({ ...patch, id: waId, atualizadoEm: new Date().toISOString(), atualizadoPor: me?.id || null }), { merge: true });
  }
  async function toggleTagConversa(waId: string, tagId: string) {
    const atuais = contatos[waId]?.tagIds || [];
    const novas = atuais.includes(tagId) ? atuais.filter(t => t !== tagId) : [...atuais, tagId];
    await salvarContato(waId, { tagIds: novas });
  }
  async function toggleRestConversa(waId: string, restId: string) {
    const efet = restsDaConversa(waId); // materializa o herdado no 1º clique
    const novas = efet.includes(restId) ? efet.filter(r => r !== restId) : [...efet, restId];
    await salvarContato(waId, { restaurantIds: novas });
  }
  async function criarTag(nome: string, cor: string) {
    const n = nome.trim(); if (!n) return;
    await addDoc(collection(db, "whatsappTags"), sanitizeForFirestore({ nome: n, cor, criadoEm: new Date().toISOString() }));
  }
  async function excluirTag(id: string) {
    await deleteDoc(doc(db, "whatsappTags", id));
  }

  async function responder() {
    const txt = resposta.trim();
    if (!txt || !sel || !numeroSel) return;
    setEnviando(true);
    try {
      const r = await fetch("/api/evolution-enviar", {
        method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ instancia: numeroSel, to: sel, texto: txt, autorNome: me?.nome || "" }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && (j as { ok?: boolean }).ok) {
        // Guarda o texto CRU (sem o prefixo *Nome:*); a autoria vai em autorNome.
        await addDoc(collection(db, "whatsappMensagens"), sanitizeForFirestore({ waId: sel, nome: nomeSel || null, direcao: "out", tipo: "text", texto: txt, timestamp: new Date().toISOString(), recebidoEm: new Date().toISOString(), lido: true, numeroId: numeroSel, autorNome: me?.nome || null, autorId: me?.id || null }));
        setResposta("");
      } else {
        alert((j as { naoConfigurado?: boolean }).naoConfigurado ? "Evolution ainda não configurada (env vars na Vercel)." : ((j as { error?: string }).error || "Falha ao enviar."));
      }
    } catch (e) { alert("Falha ao enviar: " + (e instanceof Error ? e.message : "?")); }
    setEnviando(false);
  }

  if (!podeVer && !embutido) return <div className="max-w-2xl mx-auto py-12 text-center"><div className="text-4xl mb-3">🔒</div><p className="text-gray-700 dark:text-gray-300 font-medium">Sem acesso à caixa de entrada do WhatsApp.</p></div>;

  const contatoSel = sel ? contatos[sel] : undefined;
  const pessoaSel = sel ? pessoaDaConversa(sel) : null;
  const restsSel = sel ? restsDaConversa(sel) : [];
  const herdaRest = sel ? restHerdado(sel) : false;
  const autoMatch = sel ? pessoaByFone[foneKey(sel)] : null;

  const abaEfetiva = embutido ? "conversas" : tab;
  return (
    <div className={embutido ? "" : "max-w-4xl"}>
      {!embutido && (
        <div className="mb-3">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">💬 WhatsApp</h1>
          <p className="text-xs text-gray-500">Mensagens recebidas no número da plataforma (número único, não por restaurante).</p>
        </div>
      )}

      {!embutido && (
        <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-800">
          {([["conversas", "Conversas"], ["templates", "Templates"]] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => { setTab(v); setSel(null); }}
              className={`px-4 py-2 text-sm font-semibold -mb-px border-b-2 ${tab === v ? "border-emerald-500 text-emerald-600 dark:text-emerald-300" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>{l}</button>
          ))}
        </div>
      )}

      {abaEfetiva === "templates" ? (
        <WhatsappTemplatesTab podeConfig={podeResponder} />
      ) : (
      <>
      {!sel && (
        <>
          {/* Seletor de NÚMERO (caixa) — só os que a pessoa pode acessar */}
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            {numerosVisiveis.map(n => (
              <button key={n.id} type="button" onClick={() => setNumeroSel(n.id)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${numeroSel === n.id ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>
                📱 {n.nome}
              </button>
            ))}
            {podeConfigNum && <button type="button" onClick={() => setGerNumeros(true)} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50">＋ Números</button>}
          </div>
          {numerosVisiveis.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500 mb-3">
              {numeros.length === 0 ? (podeConfigNum ? "Nenhum número configurado ainda. Clique em “＋ Números” pra registrar." : "Nenhum número de WhatsApp configurado.") : "Você não tem número de WhatsApp atribuído."}
            </div>
          )}

          {/* Filtro por restaurante + gerenciar tags */}
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <FiltroChip ativo={filtroRest === "all"} onClick={() => setFiltroRest("all")}>Todos</FiltroChip>
            {restaurants.map(r => (
              <FiltroChip key={r.id} ativo={filtroRest === r.id} onClick={() => setFiltroRest(r.id)}>{r.nome}</FiltroChip>
            ))}
            <FiltroChip ativo={filtroRest === "none"} onClick={() => setFiltroRest("none")}>Sem vínculo</FiltroChip>
            {podeTags && <button type="button" onClick={() => setGerenciarTags(true)} className="ml-auto text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50 shrink-0">🏷 Tags</button>}
          </div>
          {/* Filtro por tag */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              <FiltroChip ativo={!filtroTag} onClick={() => setFiltroTag(null)}>Todas as tags</FiltroChip>
              {tags.map(t => (
                <button key={t.id} type="button" onClick={() => setFiltroTag(filtroTag === t.id ? null : t.id)}
                  className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${filtroTag === t.id ? "text-white" : "text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800"}`}
                  style={filtroTag === t.id ? { background: t.cor || "#6366f1", borderColor: t.cor || "#6366f1" } : undefined}>
                  <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: t.cor || "#6366f1" }} />{t.nome}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {!sel ? (
        conversasFiltradas.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">{conversas.length === 0 ? "Nenhuma mensagem recebida ainda. Quando alguém mandar no WhatsApp do planejamento.app, aparece aqui." : "Nenhuma conversa nesse filtro."}</div>
        ) : (
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
            {conversasFiltradas.map(c => {
              const rs = restsDaConversa(c.waId);
              const cTags = (contatos[c.waId]?.tagIds || []).map(id => tagById[id]).filter(Boolean) as WhatsappTag[];
              return (
                <button key={c.waId} type="button" onClick={() => { setSel(c.waId); setDetalhes(false); }} className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                  <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center text-lg shrink-0">💬</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 dark:text-gray-100 truncate">{nomeConversa(c.waId, c.nome)}</span>
                      {c.naoLidas > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white">{c.naoLidas}</span>}
                      {rs.slice(0, 2).map(r => <span key={r} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300">{restNome[r] || "—"}</span>)}
                      {rs.length > 2 && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300">+{rs.length - 2}</span>}
                      {cTags.map(t => <span key={t.id} className="inline-block w-2 h-2 rounded-full" style={{ background: t.cor || "#6366f1" }} title={t.nome} />)}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{c.ultima.direcao === "out" ? "Você: " : ""}{c.ultima.texto || `[${c.ultima.tipo || "msg"}]`}</div>
                  </div>
                  <span className="text-[10px] text-gray-400 shrink-0">{hhmm(c.ultima.timestamp)}</span>
                </button>
              );
            })}
          </div>
        )
      ) : (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col h-[72vh]">
          {/* Header da conversa */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 dark:border-gray-800">
            <button type="button" onClick={() => setSel(null)} className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">←</button>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-gray-900 dark:text-gray-100 truncate flex items-center gap-2 flex-wrap">
                {nomeSel}
                {restsSel.map(r => <span key={r} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300">{restNome[r] || "—"}</span>)}
              </div>
              <div className="text-[11px] text-gray-400">{foneBonito(sel)}{pessoaSel && <> · 👤 {pessoaSel.nome}</>}</div>
            </div>
            {podeVincular && <button type="button" onClick={() => setDetalhes(v => !v)} className={`text-xs px-2 py-1 rounded-lg border ${detalhes ? "border-indigo-400 text-indigo-600 dark:text-indigo-300" : "border-gray-200 dark:border-gray-800 text-gray-500"}`}>ⓘ Detalhes</button>}
          </div>

          {/* Painel de detalhes: vínculo + restaurante + tags */}
          {detalhes && podeVincular && (
            <div className="px-3 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30 space-y-3 text-sm">
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Pessoa vinculada</label>
                <PessoaPicker pessoas={pessoas} valueId={contatoSel?.pessoaId || null} autoMatch={autoMatch} onChange={id => void salvarContato(sel, { pessoaId: id })} />
                {!contatoSel?.pessoaId && autoMatch && <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">Vinculada automaticamente pelo número: <strong>{autoMatch.nome}</strong></p>}
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Restaurantes <span className="normal-case font-normal text-gray-400">(pode marcar vários)</span></label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {restaurants.map(r => {
                    const on = restsSel.includes(r.id);
                    return (
                      <button key={r.id} type="button" onClick={() => void toggleRestConversa(sel, r.id)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${on ? "border-indigo-500 bg-indigo-500 text-white" : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>
                        {r.nome}
                      </button>
                    );
                  })}
                </div>
                {herdaRest && restsSel.length > 0 && <p className="text-[11px] text-gray-400 mt-1">Herdado da pessoa. Clique pra ajustar manualmente.</p>}
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Tags</label>
                <div className="flex flex-wrap gap-1.5 mt-1 items-center">
                  {tags.length === 0 && <span className="text-[11px] text-gray-400">Nenhuma tag criada.</span>}
                  {tags.map(t => {
                    const on = (contatoSel?.tagIds || []).includes(t.id);
                    return (
                      <button key={t.id} type="button" onClick={() => void toggleTagConversa(sel, t.id)}
                        className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${on ? "text-white" : "text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800"}`}
                        style={on ? { background: t.cor || "#6366f1", borderColor: t.cor || "#6366f1" } : undefined}>
                        <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: t.cor || "#6366f1" }} />{t.nome}
                      </button>
                    );
                  })}
                  <button type="button" onClick={() => setGerenciarTags(true)} className="text-xs text-indigo-600 dark:text-indigo-400 px-1.5">+ nova</button>
                </div>
              </div>
            </div>
          )}

          {/* Mensagens */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {thread.map(m => (
              <div key={m.id} className={`flex ${m.direcao === "out" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.direcao === "out" ? "bg-emerald-100 dark:bg-emerald-900/30 text-gray-900 dark:text-gray-100" : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100"}`}>
                  <div className="whitespace-pre-wrap break-words">{m.texto || `[${m.tipo || "msg"}]`}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5 text-right">{m.direcao === "out" && m.autorNome ? `${m.autorNome} · ` : ""}{hhmm(m.timestamp)}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Resposta */}
          {podeResponder && (
            <div className="border-t border-gray-200 dark:border-gray-800 p-2">
              <div className="flex items-end gap-2">
                <textarea value={resposta} onChange={e => setResposta(e.target.value)} rows={1} placeholder="Responder…" className="flex-1 px-3 py-2 text-base rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 resize-none" onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void responder(); } }} />
                <Button onClick={() => void responder()} disabled={enviando || !resposta.trim()}>{enviando ? "…" : "Enviar"}</Button>
              </div>
            </div>
          )}
        </div>
      )}

      </>
      )}

      {gerenciarTags && <GerenciarTagsModal tags={tags} onClose={() => setGerenciarTags(false)} onCriar={criarTag} onExcluir={excluirTag} />}
      {gerNumeros && <NumerosModal numeros={numeros} pessoas={pessoas} pessoaId={me?.id || null} onClose={() => setGerNumeros(false)} />}
    </div>
  );
}

// Cadastro dos números DENTRO do app: cria a instância na Evolution, aponta o
// webhook e mostra o QR aqui mesmo. O id do doc = nome da instância.
async function chamarInstancia(acao: string, instancia: string): Promise<{ ok?: boolean; qr?: string | null; estado?: string; naoConfigurado?: boolean; error?: string }> {
  const r = await fetch("/api/evolution-instancia", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ acao, instancia }) });
  return r.json().catch(() => ({}));
}

const ESTADO_META: Record<string, { label: string; cls: string }> = {
  open: { label: "Conectado", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  connecting: { label: "Conectando…", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  close: { label: "Desconectado", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" },
};
function NumerosModal({ numeros, pessoas, pessoaId, onClose }: { numeros: WhatsappNumero[]; pessoas: Pessoa[]; pessoaId: string | null; onClose: () => void }) {
  const [nome, setNome] = useState("");
  const [instancia, setInstancia] = useState("");
  const [descricao, setDescricao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [qr, setQr] = useState<{ instancia: string; nome: string; qr: string | null } | null>(null);
  const [estados, setEstados] = useState<Record<string, string>>({});
  const [expandido, setExpandido] = useState<string | null>(null);
  const [buscaU, setBuscaU] = useState("");
  const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  // Poll do status de conexão de cada número.
  async function atualizarStatus() {
    const res = await Promise.all(numeros.map(async n => [n.id, (await chamarInstancia("status", n.id)).estado || "unknown"] as const));
    setEstados(Object.fromEntries(res));
  }
  useEffect(() => { void atualizarStatus(); const t = setInterval(() => void atualizarStatus(), 8000); return () => clearInterval(t); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [numeros.map(n => n.id).join(",")]);

  async function criar() {
    const id = slug(instancia || nome);
    if (!id) { alert("Informe um nome pro número."); return; }
    if (!nome.trim()) { alert("Informe um rótulo amigável."); return; }
    if (numeros.some(n => n.id === id)) { alert("Já existe um número com esse identificador."); return; }
    setSalvando(true);
    try {
      const r = await chamarInstancia("create", id);
      if (r.naoConfigurado) { alert("Evolution ainda não configurada na Vercel (env vars EVOLUTION_*)."); setSalvando(false); return; }
      if (r.error) { alert("Erro na Evolution: " + r.error); setSalvando(false); return; }
      await setDoc(doc(db, "whatsappNumeros", id), sanitizeForFirestore({ id, nome: nome.trim(), descricao: descricao.trim() || undefined, ativo: true, usuariosIds: [], criadoEm: new Date().toISOString(), criadoPor: pessoaId }));
      setNome(""); setInstancia(""); setDescricao("");
      setQr({ instancia: id, nome: nome.trim() || id, qr: r.qr || null });
    } catch (e) { alert("Erro: " + (e instanceof Error ? e.message : "?")); }
    finally { setSalvando(false); }
  }
  async function patch(id: string, p: Partial<WhatsappNumero>) { await setDoc(doc(db, "whatsappNumeros", id), sanitizeForFirestore(p), { merge: true }); }
  async function excluir(n: WhatsappNumero) {
    if (!confirm(`Remover "${n.nome}"? Desconecta e apaga a instância na Evolution (não apaga as conversas já recebidas).`)) return;
    await chamarInstancia("delete", n.id).catch(() => {});
    await deleteDoc(doc(db, "whatsappNumeros", n.id));
  }
  const toggleUsuario = (n: WhatsappNumero, pid: string) => {
    const cur = n.usuariosIds || [];
    void patch(n.id, { usuariosIds: cur.includes(pid) ? cur.filter(x => x !== pid) : [...cur, pid] });
  };

  const inp = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
  const pessoasFiltradas = (q: string) => { const s = q.trim().toLowerCase(); return [...pessoas].sort((a, b) => a.nome.localeCompare(b.nome)).filter(p => !s || p.nome.toLowerCase().includes(s)).slice(0, 100); };

  return (
    <>
    <Modal onClose={onClose} title="⚙️ Números de WhatsApp" maxWidth="max-w-2xl">
      <div className="space-y-4">
        {/* Adicionar */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3 space-y-2">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">➕ Adicionar número</div>
          <p className="text-[11px] text-gray-500">Cria o número na hora e mostra o <b>QR</b> pra conectar o celular — sem sair daqui.</p>
          <input value={nome} onChange={e => setNome(e.target.value)} className={inp} placeholder="Rótulo (ex.: Sororoca · Clientes)" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input value={instancia} onChange={e => setInstancia(e.target.value)} className={inp} placeholder="Identificador (opcional)" />
            <input value={descricao} onChange={e => setDescricao(e.target.value)} className={inp} placeholder="Descrição (clientes, fornecedores…)" />
          </div>
          <div className="flex justify-end"><Button onClick={criar} disabled={salvando}>{salvando ? "Criando…" : "Adicionar e conectar"}</Button></div>
        </div>

        {/* Lista de números */}
        <div className="space-y-2">
          {numeros.length === 0 && <div className="text-center text-sm text-gray-400 py-4">Nenhum número ainda.</div>}
          {numeros.map(n => {
            const est = estados[n.id] || "unknown";
            const em = ESTADO_META[est] || { label: "—", cls: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" };
            const nUsers = (n.usuariosIds || []).length;
            const aberto = expandido === n.id;
            return (
              <div key={n.id} className="rounded-xl border border-gray-200 dark:border-gray-800">
                <div className="flex items-center gap-2 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex items-center gap-2">
                      {n.nome}
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${em.cls}`}>{est === "unknown" ? "…" : em.label}</span>
                      {n.ativo === false && <span className="text-[10px] text-gray-400">(inativo)</span>}
                    </div>
                    <div className="text-[11px] text-gray-400 truncate">instância: {n.id}{n.descricao ? ` · ${n.descricao}` : ""} · {nUsers} usuário{nUsers === 1 ? "" : "s"}</div>
                  </div>
                  <button type="button" onClick={() => setQr({ instancia: n.id, nome: n.nome, qr: null })} className="text-[11px] px-2 py-1 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-300">{est === "open" ? "🔄 Reconectar" : "🔌 Conectar"}</button>
                  <button type="button" onClick={() => setExpandido(aberto ? null : n.id)} className="text-[11px] px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">👥 Usuários</button>
                  <button type="button" onClick={() => void excluir(n)} className="text-gray-400 hover:text-rose-600 text-sm">🗑️</button>
                </div>
                {aberto && (
                  <div className="px-3 pb-3 border-t border-gray-100 dark:border-gray-800 pt-2 space-y-2">
                    <div className="text-[11px] font-semibold text-gray-500 uppercase">Quem pode usar este número</div>
                    <input value={buscaU} onChange={e => setBuscaU(e.target.value)} className={inp} placeholder="Buscar pessoa…" />
                    <div className="max-h-44 overflow-y-auto flex flex-wrap gap-x-4 gap-y-1">
                      {pessoasFiltradas(buscaU).map(p => (
                        <label key={p.id} className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                          <input type="checkbox" checked={(n.usuariosIds || []).includes(p.id)} onChange={() => toggleUsuario(n, p.id)} />{p.nome}
                        </label>
                      ))}
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold text-gray-500 uppercase mt-2 mb-1">Regras de uso (opcional)</div>
                      <textarea defaultValue={n.regras || ""} onBlur={e => { if (e.target.value !== (n.regras || "")) void patch(n.id, { regras: e.target.value }); }} rows={2} className={inp} placeholder="Ex.: só responder em horário comercial; sempre confirmar preço antes de fechar…" />
                    </div>
                    <button type="button" onClick={() => void patch(n.id, { ativo: !(n.ativo !== false) })} className="text-[11px] text-gray-500 hover:underline">{n.ativo === false ? "Reativar número" : "Desativar número (esconde do inbox)"}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-gray-400">Só quem estiver marcado em <b>Usuários</b> vê/responde cada número. Master vê todos. O que cada um pode fazer (ver/responder/tags) segue no Perfil de Acesso.</p>
      </div>
    </Modal>
    {qr && <QrModal instancia={qr.instancia} nome={qr.nome} qrInicial={qr.qr} onClose={() => { setQr(null); void atualizarStatus(); }} />}
    </>
  );
}

// Mostra o QR e detecta a conexão (polling do status). Regenera o QR se expirar.
function QrModal({ instancia, nome, qrInicial, onClose }: { instancia: string; nome: string; qrInicial: string | null; onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(qrInicial);
  const [estado, setEstado] = useState<string>("connecting");
  const [carregando, setCarregando] = useState(false);

  async function regenerar() {
    setCarregando(true);
    const r = await chamarInstancia("connect", instancia);
    if (r.qr) setQr(r.qr);
    setCarregando(false);
  }
  useEffect(() => { if (!qrInicial) void regenerar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    const t = setInterval(async () => {
      const r = await chamarInstancia("status", instancia);
      if (r.estado) setEstado(r.estado);
      if (r.estado === "open") clearInterval(t);
    }, 3000);
    return () => clearInterval(t);
  }, [instancia]);

  const conectado = estado === "open";
  return (
    <Modal onClose={onClose} title={`📱 Conectar · ${nome}`} maxWidth="max-w-sm">
      {conectado ? (
        <div className="text-center py-6 space-y-3">
          <div className="text-5xl">✅</div>
          <p className="font-medium text-gray-900 dark:text-gray-100">Número conectado!</p>
          <Button onClick={onClose}>Fechar</Button>
        </div>
      ) : (
        <div className="text-center space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">No celular do número: <b>Aparelhos conectados → Conectar um aparelho</b> e escaneie:</p>
          {qr ? <img src={qr} alt="QR Code" className="mx-auto w-56 h-56 rounded-lg border border-gray-200 dark:border-gray-700 bg-white" /> : <div className="py-16 text-gray-400 text-sm">Gerando QR…</div>}
          <p className="text-[11px] text-gray-400">O QR expira em ~40s. Se não ler, gere um novo.</p>
          <div className="flex gap-2 justify-center">
            <Button variant="secondary" onClick={() => void regenerar()} disabled={carregando}>{carregando ? "…" : "↻ Gerar novo QR"}</Button>
            <Button variant="ghost" onClick={onClose}>Fechar</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Seletor de Pessoa com busca por nome/telefone, ordenado alfabeticamente.
// Native <select> no mobile não permite pesquisar numa lista longa.
function PessoaPicker({ pessoas, valueId, autoMatch, onChange }: { pessoas: Pessoa[]; valueId: string | null; autoMatch: Pessoa | null; onChange: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const selecionada = pessoas.find(p => p.id === valueId) || null;
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qd = soDig(busca);
    return pessoas
      .filter(p => { if (!q) return true; return p.nome.toLowerCase().includes(q) || (!!qd && soDig(p.whatsapp).includes(qd)); })
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
      .slice(0, 60);
  }, [pessoas, busca]);

  const rotulo = selecionada ? selecionada.nome : (autoMatch ? `${autoMatch.nome} (automático)` : "— não vinculada —");

  return (
    <div className="relative mt-1">
      <button type="button" onClick={() => { setOpen(v => !v); setBusca(""); }}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-base rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-left">
        <span className={`truncate ${selecionada ? "text-gray-900 dark:text-gray-100" : "text-gray-500"}`}>{rotulo}</span>
        <span className="text-gray-400 shrink-0">⌄</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[190]" onClick={() => setOpen(false)} />
          <div className="absolute z-[200] mt-1 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl max-h-72 overflow-hidden flex flex-col">
            <div className="p-2 border-b border-gray-100 dark:border-gray-800">
              <input autoFocus value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar nome ou número…"
                className="w-full px-3 py-2 text-base rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            </div>
            <div className="overflow-y-auto">
              <button type="button" onClick={() => { onChange(null); setOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/40">— não vinculada —</button>
              {lista.length === 0 && <div className="px-3 py-3 text-sm text-gray-400">Nenhuma pessoa encontrada.</div>}
              {lista.map(p => (
                <button key={p.id} type="button" onClick={() => { onChange(p.id); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/40 ${p.id === valueId ? "bg-indigo-50 dark:bg-indigo-900/20" : ""}`}>
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{p.nome}</div>
                  {p.whatsapp && <div className="text-[11px] text-gray-400">{foneBonito(p.whatsapp)}</div>}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FiltroChip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${ativo ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>{children}</button>
  );
}

function GerenciarTagsModal({ tags, onClose, onCriar, onExcluir }: { tags: WhatsappTag[]; onClose: () => void; onCriar: (nome: string, cor: string) => Promise<void>; onExcluir: (id: string) => Promise<void> }) {
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState(PALETA[0]!);
  return (
    <Modal title="Tags do WhatsApp" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {tags.length === 0 && <span className="text-sm text-gray-400">Nenhuma tag ainda.</span>}
          {tags.map(t => (
            <span key={t.id} className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-full text-white" style={{ background: t.cor || "#6366f1" }}>
              {t.nome}
              <button type="button" onClick={() => void onExcluir(t.id)} className="opacity-80 hover:opacity-100 leading-none">×</button>
            </span>
          ))}
        </div>
        <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Nova tag</label>
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome da tag" className="w-full mt-1 px-3 py-2 text-base rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
            onKeyDown={e => { if (e.key === "Enter" && nome.trim()) { void onCriar(nome, cor); setNome(""); } }} />
          <div className="flex items-center gap-2 mt-2">
            {PALETA.map(c => (
              <button key={c} type="button" onClick={() => setCor(c)} className={`w-6 h-6 rounded-full ${cor === c ? "ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-900" : ""}`} style={{ background: c }} />
            ))}
          </div>
          <div className="mt-3 text-right">
            <Button onClick={() => { if (nome.trim()) { void onCriar(nome, cor); setNome(""); } }} disabled={!nome.trim()}>Adicionar</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
