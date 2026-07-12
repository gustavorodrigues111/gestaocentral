// Caixa de entrada do WhatsApp da plataforma. Mostra as conversas recebidas
// (whatsappMensagens, gravadas pelo webhook) e permite responder — texto livre
// funciona dentro da janela de 24h da última mensagem da pessoa; fora disso a
// Meta exige template. Número é único da plataforma (não por restaurante).
//
// Cada conversa (waId) pode ser vinculada a uma Pessoa (auto-match pelo número
// cadastrado) e a um restaurante, além de receber tags. Isso permite dividir a
// caixa por restaurante e filtrar por tag. Metadados em whatsappContatos/{waId}
// e catálogo de tags em whatsappTags.
import { useEffect, useMemo, useRef, useState } from "react";
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
import type { Pessoa, WhatsappTag, WhatsappContato, WhatsappNumero, Cliente } from "../../core/types";

type Msg = { id: string; waId: string; nome?: string | null; direcao: "in" | "out"; tipo?: string; texto?: string; timestamp?: string; recebidoEm?: string; lido?: boolean; autorNome?: string | null; numeroId?: string; sistema?: boolean };

const hhmm = (iso?: string) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
const fmtBRcurto = (ymd?: string | null) => { if (!ymd) return ""; const [a, m, d] = String(ymd).split("-"); return d ? `${d}/${m}/${a?.slice(2) || ""}` : String(ymd); };
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
  const podeVer = isMaster || can("whatsapp", "ver");
  const podeResponder = isMaster || can("whatsapp", "responder");
  const podeVincular = isMaster || can("whatsapp", "vincular");

  const [numeros, setNumeros] = useState<WhatsappNumero[]>([]);
  const [numeroSel, setNumeroSel] = useState<string | null>(null);
  const [novaConversa, setNovaConversa] = useState(false);
  const [qrRecon, setQrRecon] = useState<{ instancia: string; nome: string } | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [contatos, setContatos] = useState<Record<string, WhatsappContato>>({});
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [tags, setTags] = useState<WhatsappTag[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [resposta, setResposta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [filtroTag, setFiltroTag] = useState<string | null>(null);
  const [detalhes, setDetalhes] = useState(false);
  const [tab, setTab] = useState<"conversas" | "templates">("conversas");

  const ridsKey = restaurants.map(r => r.id).join(",");

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

  // Clientes do Reservas+CRM (das empresas do usuário) — pra casar por telefone.
  useEffect(() => {
    const rids = ridsKey ? ridsKey.split(",").slice(0, 10) : [];
    if (!rids.length) { setClientes([]); return; }
    const u = onSnapshot(query(collection(db, "clientes"), where("restaurantId", "in", rids)),
      snap => setClientes(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cliente)));
    return () => u();
  }, [ridsKey]);

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
  const clienteById = useMemo(() => Object.fromEntries(clientes.map(c => [c.id, c])), [clientes]);
  const clienteByFone = useMemo(() => {
    const m: Record<string, Cliente> = {};
    for (const c of clientes) { const k = foneKey(c.telefone); if (k && !m[k]) m[k] = c; }
    return m;
  }, [clientes]);

  // Resolve Pessoa vinculada (manual tem prioridade sobre auto-match).
  function pessoaDaConversa(waId: string): Pessoa | null {
    const c = contatos[waId];
    if (c?.pessoaId) return pessoaById[c.pessoaId] || null;
    return pessoaByFone[foneKey(waId)] || null;
  }
  // Resolve Cliente (CRM) vinculado (manual tem prioridade sobre auto-match por telefone).
  function clienteDaConversa(waId: string): Cliente | null {
    const c = contatos[waId];
    if (c?.clienteId) return clienteById[c.clienteId] || null;
    if (c?.clienteId === null) return null;   // desvinculado manualmente
    return clienteByFone[foneKey(waId)] || null;
  }

  // ── Números acessíveis + número selecionado ───────────────────────────────
  // Master vê todos; os demais só os números em que estão em usuariosIds E que
  // pertencem a uma empresa dele (número travado numa empresa não vaza pra outra).
  const meRids = me?.restaurantIds || [];
  const numerosVisiveis = isMaster ? numeros : numeros.filter(n =>
    (n.usuariosIds || []).includes(me?.id || "") &&
    ((n.restaurantIds || []).length === 0 || (n.restaurantIds || []).some(r => meRids.includes(r)))
  );
  useEffect(() => {
    if (numerosVisiveis.length === 0) { if (numeroSel !== null) setNumeroSel(null); return; }
    if (!numeroSel || !numerosVisiveis.some(n => n.id === numeroSel)) setNumeroSel(numerosVisiveis[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numerosVisiveis.map(n => n.id).join(","), numeroSel]);
  // Só as mensagens do número selecionado.
  const msgsDoNumero = useMemo(() => msgs.filter(m => m.numeroId === numeroSel), [msgs, numeroSel]);

  // ── Saúde da conexão do número selecionado: avisa quando cai (device desligado,
  // sessão expirada). Sem isso, o inbox parece "vivo" mas nada entra/sai. ──
  const [statusConexao, setStatusConexao] = useState<string>("unknown");
  useEffect(() => {
    if (!numeroSel) { setStatusConexao("unknown"); return; }
    let vivo = true;
    const checar = async () => { const r = await chamarInstancia("status", numeroSel).catch(() => null); if (vivo && r) setStatusConexao(r.estado || "unknown"); };
    setStatusConexao("unknown"); void checar();
    const t = setInterval(checar, 20000);
    return () => { vivo = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numeroSel]);
  const numeroSelObj = numeros.find(n => n.id === numeroSel) || null;
  const desconectado = !!numeroSel && statusConexao === "close";

  // ── Alerta rápido: com a aba aberta (mesmo em segundo plano), piscar o título
  // + beep quando chega mensagem nova não-lida num número que a pessoa acessa. ──
  const totalNaoLidas = useMemo(() => {
    const vis = new Set(numerosVisiveis.map(n => n.id));
    return msgs.filter(m => m.direcao === "in" && !m.lido && m.numeroId && vis.has(m.numeroId)).length;
  }, [msgs, numerosVisiveis]);
  const prevUnread = useRef(totalNaoLidas);
  const tituloOrig = useRef(typeof document !== "undefined" ? document.title : "");
  const flashRef = useRef<number | null>(null);
  useEffect(() => {
    if (totalNaoLidas > prevUnread.current && typeof document !== "undefined" && document.hidden) {
      try { const AC = (window as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext; if (AC) { const ctx = new AC(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.value = 0.05; o.start(); o.stop(ctx.currentTime + 0.15); } } catch { /* beep é best-effort */ }
      if (flashRef.current) clearInterval(flashRef.current);
      let on = false;
      flashRef.current = window.setInterval(() => { document.title = (on = !on) ? `💬 (${totalNaoLidas}) nova mensagem` : tituloOrig.current; }, 1000);
    }
    prevUnread.current = totalNaoLidas;
  }, [totalNaoLidas]);
  useEffect(() => {
    const limpar = () => { if (!document.hidden && flashRef.current) { clearInterval(flashRef.current); flashRef.current = null; document.title = tituloOrig.current; } };
    document.addEventListener("visibilitychange", limpar);
    window.addEventListener("focus", limpar);
    return () => { document.removeEventListener("visibilitychange", limpar); window.removeEventListener("focus", limpar); if (flashRef.current) { clearInterval(flashRef.current); document.title = tituloOrig.current; } };
  }, []);

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

  // Filtro por tag (o número já é da empresa; não filtra por empresa aqui).
  const conversasFiltradas = useMemo(() => conversas.filter(c => {
    if (filtroTag) { if (!(contatos[c.waId]?.tagIds || []).includes(filtroTag)) return false; }
    return true;
  }), [conversas, filtroTag, contatos]);

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

  // Marca a conversa como NÃO lida (última mensagem recebida vira não-lida) e volta pra lista.
  async function marcarNaoLida(waId: string) {
    const inbound = msgsDoNumero.filter(m => m.waId === waId && m.direcao === "in");
    const ultima = inbound[inbound.length - 1];
    setSel(null);
    if (ultima) await updateDoc(doc(db, "whatsappMensagens", ultima.id), { lido: false }).catch(() => {});
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
  const autoMatch = sel ? pessoaByFone[foneKey(sel)] : null;
  const clienteSel = sel ? clienteDaConversa(sel) : null;
  const clienteAuto = sel ? clienteByFone[foneKey(sel)] : null;
  const [transferir, setTransferir] = useState(false);

  // Vincular/desvincular cliente do CRM.
  async function vincularCliente(clienteId: string | null) { if (sel) await salvarContato(sel, { clienteId }); }
  // Transferir a conversa pra outro atendente (+ registra no histórico).
  async function transferirPara(p: Pessoa, nota: string) {
    if (!sel) return;
    await salvarContato(sel, { atribuidoA: p.id, atribuidoNome: p.nome });
    await addDoc(collection(db, "whatsappMensagens"), sanitizeForFirestore({
      waId: sel, numeroId: numeroSel, direcao: "out", tipo: "sistema", sistema: true, lido: true,
      texto: `🔀 Conversa transferida para ${p.nome} por ${me?.nome || "—"}${nota ? ` — ${nota}` : ""}`,
      timestamp: new Date().toISOString(), recebidoEm: new Date().toISOString(), autorNome: me?.nome || null,
    }));
    setTransferir(false);
  }

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
      {desconectado && (
        <div className="rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 p-4 mb-3 flex items-start gap-3">
          <span className="text-xl leading-none">🔌</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">Número desconectado{numeroSelObj ? ` — ${numeroSelObj.nome}` : ""}</p>
            <p className="text-xs text-rose-600/90 dark:text-rose-300/80 mt-0.5">
              {isMaster
                ? "O aparelho saiu do ar (celular desligado, sem internet ou sessão expirada). Enquanto isso, nenhuma mensagem entra ou sai por este número. Reconecte lendo o QR de novo."
                : "O aparelho deste número saiu do ar, então nenhuma mensagem entra ou sai por ele no momento. Solicite ao administrador que refaça a conexão do número."}
            </p>
            {isMaster && (
              <button type="button" onClick={() => setQrRecon({ instancia: numeroSel!, nome: numeroSelObj?.nome || numeroSel! })}
                className="mt-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700">🔄 Reconectar agora</button>
            )}
          </div>
        </div>
      )}
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
            {podeResponder && numeroSel && <button type="button" onClick={() => setNovaConversa(true)} className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shrink-0">＋ Nova conversa</button>}
          </div>
          {numerosVisiveis.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500 mb-3">
              {numeros.length === 0 ? (isMaster ? "Nenhum número configurado ainda. Vá na aba Configuração pra adicionar e conectar." : "Nenhum número de WhatsApp configurado.") : "Você não tem número de WhatsApp atribuído."}
            </div>
          )}

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
              const cTags = (contatos[c.waId]?.tagIds || []).map(id => tagById[id]).filter(Boolean) as WhatsappTag[];
              const naoLida = c.naoLidas > 0;
              return (
                <button key={c.waId} type="button" onClick={() => { setSel(c.waId); setDetalhes(false); }}
                  className={`w-full text-left flex items-center gap-3 px-4 py-3 transition-colors ${naoLida ? "bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/30" : "hover:bg-gray-50 dark:hover:bg-gray-800/40"}`}>
                  <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center text-lg shrink-0">💬</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`truncate ${naoLida ? "font-bold text-gray-900 dark:text-gray-50" : "font-medium text-gray-900 dark:text-gray-100"}`}>{nomeConversa(c.waId, c.nome)}</span>
                      {naoLida && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500 text-white">{c.naoLidas}</span>}
                      {cTags.map(t => <span key={t.id} className="inline-block w-2 h-2 rounded-full" style={{ background: t.cor || "#6366f1" }} title={t.nome} />)}
                    </div>
                    <div className={`text-xs truncate ${naoLida ? "text-gray-700 dark:text-gray-200 font-medium" : "text-gray-500"}`}>{c.ultima.direcao === "out" ? "Você: " : ""}{c.ultima.texto || `[${c.ultima.tipo || "msg"}]`}</div>
                  </div>
                  <span className="text-[10px] text-gray-400 shrink-0">{hhmm(c.ultima.timestamp)}</span>
                </button>
              );
            })}
          </div>
        )
      ) : (
        <>
        {/* Voltar — fora da conversa, pra ficar claro que retorna à lista */}
        <button type="button" onClick={() => setSel(null)} className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100">← Voltar às conversas</button>
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col h-[72vh]">
          {/* Header da conversa: nome completo → vínculo → botões */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
            <div className="text-base font-semibold text-gray-900 dark:text-gray-100 break-words">{nomeSel}</div>
            <div className="text-[11px] text-gray-400 mt-0.5 flex flex-wrap gap-x-1">
              <span>{foneBonito(sel)}</span>
              {clienteSel && <span>· <span className="text-emerald-600 dark:text-emerald-300">🧑 {clienteSel.nome} (cliente)</span></span>}
              {pessoaSel && <span>· <span className="text-indigo-600 dark:text-indigo-300">👤 {pessoaSel.nome}</span></span>}
            </div>
            {contatoSel?.atribuidoNome && <div className="text-[11px] text-gray-500 mt-0.5">🙋 Responsável: <b>{contatoSel.atribuidoNome}</b></div>}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {podeResponder && <button type="button" onClick={() => setTransferir(true)} className="text-xs px-2.5 py-1 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300">↪ Transferir</button>}
              <button type="button" onClick={() => marcarNaoLida(sel)} title="Marcar como não lida" className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-500 hover:text-rose-600">🔵 Não lida</button>
              {podeVincular && <button type="button" onClick={() => setDetalhes(v => !v)} className={`text-xs px-2.5 py-1 rounded-lg border ${detalhes ? "border-indigo-400 text-indigo-600 dark:text-indigo-300" : "border-gray-200 dark:border-gray-800 text-gray-500"}`}>ⓘ Detalhes</button>}
            </div>
          </div>

          {/* Painel de detalhes: vínculo + restaurante + tags */}
          {detalhes && podeVincular && (
            <div className="px-3 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30 space-y-3 text-sm">
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Cliente (Reservas + CRM)</label>
                {clienteSel ? (
                  <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/10 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">🧑 {clienteSel.nome}</div>
                      <div className="text-[11px] text-gray-500 truncate">
                        {(clienteSel.tags || []).slice(0, 3).join(", ")}{clienteSel.ultimaVisita ? ` · última visita ${fmtBRcurto(clienteSel.ultimaVisita)}` : ""}{typeof clienteSel.totalReservas === "number" ? ` · ${clienteSel.totalReservas} reservas` : ""}
                      </div>
                      {!contatoSel?.clienteId && clienteAuto && <div className="text-[11px] text-emerald-600 dark:text-emerald-400">Casado automaticamente pelo telefone.</div>}
                    </div>
                    <button type="button" onClick={() => void vincularCliente(null)} className="text-[11px] text-gray-400 hover:text-rose-600 shrink-0">desvincular</button>
                  </div>
                ) : (
                  <ClientePicker clientes={clientes} onChange={id => void vincularCliente(id)} />
                )}
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Pessoa vinculada (equipe)</label>
                <PessoaPicker pessoas={pessoas} valueId={contatoSel?.pessoaId || null} autoMatch={autoMatch} onChange={id => void salvarContato(sel, { pessoaId: id })} />
                {!contatoSel?.pessoaId && autoMatch && <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">Vinculada automaticamente pelo número: <strong>{autoMatch.nome}</strong></p>}
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
                </div>
              </div>
            </div>
          )}

          {/* Mensagens */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {thread.map(m => m.sistema || m.tipo === "sistema" ? (
              <div key={m.id} className="flex justify-center">
                <div className="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800/60 rounded-full px-3 py-1 text-center max-w-[90%]">{m.texto} · {hhmm(m.timestamp)}</div>
              </div>
            ) : (
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
        </>
      )}

      </>
      )}

      {novaConversa && <NovaConversaModal pessoas={pessoas} onClose={() => setNovaConversa(false)}
        onAbrir={(waId, pid) => { setNovaConversa(false); setSel(waId); if (pid) void salvarContato(waId, { pessoaId: pid }); }} />}
      {transferir && sel && <TransferModal
        pessoas={pessoas.filter(p => { const n = numeros.find(x => x.id === numeroSel); const uids = n?.usuariosIds || []; return uids.length === 0 || uids.includes(p.id); })}
        atualId={contatoSel?.atribuidoA || null} meId={me?.id || null} onClose={() => setTransferir(false)} onTransferir={transferirPara} />}
      {qrRecon && <QrModal instancia={qrRecon.instancia} nome={qrRecon.nome} qrInicial={null}
        onClose={() => { setQrRecon(null); if (numeroSel) void chamarInstancia("status", numeroSel).then(r => setStatusConexao(r.estado || "unknown")).catch(() => {}); }} />}
    </div>
  );
}

// Iniciar conversa nova: digita um número OU escolhe uma pessoa cadastrada.
function NovaConversaModal({ pessoas, onAbrir, onClose }: { pessoas: Pessoa[]; onAbrir: (waId: string, pessoaId?: string) => void; onClose: () => void }) {
  const [fone, setFone] = useState("");
  const [busca, setBusca] = useState("");
  const norm = (raw: string) => { let d = (raw || "").replace(/\D/g, ""); if (!d) return ""; if (d.length <= 11) d = "55" + d; return d; };
  const comFone = useMemo(() => {
    const s = busca.trim().toLowerCase(); const sd = soDig(busca);
    return [...pessoas].filter(p => !!soDig(p.whatsapp))
      .filter(p => !s || p.nome.toLowerCase().includes(s) || (!!sd && soDig(p.whatsapp).includes(sd)))
      .sort((a, b) => a.nome.localeCompare(b.nome)).slice(0, 40);
  }, [pessoas, busca]);
  const inp = "w-full px-3 py-2.5 text-base rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";

  return (
    <Modal onClose={onClose} title="＋ Nova conversa" maxWidth="max-w-md">
      <div className="space-y-4">
        <div>
          <label className="text-[11px] font-semibold text-gray-500 uppercase">Digitar um número</label>
          <div className="flex gap-2 mt-1">
            <input value={fone} onChange={e => setFone(e.target.value)} className={inp} placeholder="Ex.: 11 98888-7777" inputMode="tel"
              onKeyDown={e => { if (e.key === "Enter" && norm(fone)) onAbrir(norm(fone)); }} />
            <Button onClick={() => { const w = norm(fone); if (!w) { alert("Número inválido."); return; } onAbrir(w); }} disabled={!norm(fone)}>Abrir</Button>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">DDI 55 (Brasil) é assumido se você não colocar.</p>
        </div>
        <div>
          <label className="text-[11px] font-semibold text-gray-500 uppercase">Ou escolher uma pessoa cadastrada</label>
          <input value={busca} onChange={e => setBusca(e.target.value)} className={`${inp} mt-1`} placeholder="Buscar nome ou número…" />
          <div className="max-h-56 overflow-y-auto mt-1.5 rounded-lg border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {comFone.length === 0 && <div className="px-3 py-3 text-sm text-gray-400">Nenhuma pessoa com WhatsApp encontrada.</div>}
            {comFone.map(p => (
              <button key={p.id} type="button" onClick={() => onAbrir(norm(p.whatsapp || ""), p.id)} className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{p.nome}</div>
                <div className="text-[11px] text-gray-400">{foneBonito(p.whatsapp || "")}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
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
// Gestão dos números (aba Configuração do módulo WhatsApp). Self-contido.
export function NumerosManager() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const pessoaId = me?.id || null;
  const [numeros, setNumeros] = useState<WhatsappNumero[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  useEffect(() => {
    const u = onSnapshot(collection(db, "whatsappNumeros"), snap => setNumeros(snap.docs.map(d => ({ id: d.id, ...d.data() }) as WhatsappNumero)));
    return () => u();
  }, []);
  useEffect(() => {
    const rids = restaurants.map(r => r.id).slice(0, 10);
    const base = collection(db, "pessoas");
    const q = me?.isMaster ? base : (rids.length ? query(base, where("restaurantIds", "array-contains-any", rids)) : null);
    if (!q) { setPessoas([]); return; }
    const u = onSnapshot(q, snap => setPessoas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa)));
    return () => u();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.isMaster, restaurants.map(r => r.id).join(",")]);

  const [nome, setNome] = useState("");
  const [instancia, setInstancia] = useState("");
  const [descricao, setDescricao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [qr, setQr] = useState<{ instancia: string; nome: string; qr: string | null } | null>(null);
  const [estados, setEstados] = useState<Record<string, string>>({});
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
      setNome(""); setInstancia(""); setDescricao(""); setAddOpen(false);
      setQr({ instancia: id, nome: nome.trim() || id, qr: r.qr || null });
    } catch (e) { alert("Erro: " + (e instanceof Error ? e.message : "?")); }
    finally { setSalvando(false); }
  }
  async function excluir(n: WhatsappNumero) {
    if (!confirm(`Remover "${n.nome}"? Desconecta e apaga a instância na Evolution (não apaga as conversas já recebidas).`)) return;
    await chamarInstancia("delete", n.id).catch(() => {});
    await deleteDoc(doc(db, "whatsappNumeros", n.id));
  }

  const inp = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";

  return (
    <div>
      <div className="space-y-4">
        {/* Adicionar — só um botão; o resto vai num modal */}
        <div className="flex justify-end">
          <Button onClick={() => { setNome(""); setInstancia(""); setDescricao(""); setAddOpen(true); }}>➕ Adicionar novo número</Button>
        </div>

        {/* Lista de números */}
        <div className="space-y-2.5">
          {numeros.length === 0 && <div className="text-center text-sm text-gray-400 py-4">Nenhum número ainda.</div>}
          {numeros.map(n => (
            <NumeroConfigCard key={n.id} numero={n} estado={estados[n.id] || "unknown"} pessoas={pessoas} restaurants={restaurants}
              onQr={() => setQr({ instancia: n.id, nome: n.nome, qr: null })}
              onLogout={async () => { if (!confirm(`Desconectar "${n.nome}"? O número sai do ar até reconectar.`)) return; await chamarInstancia("logout", n.id); void atualizarStatus(); }}
              onExcluir={() => void excluir(n)} />
          ))}
        </div>
        <p className="text-[11px] text-gray-400">Só quem estiver marcado em <b>Usuários</b> vê/responde cada número. Master vê todos. O que cada um pode fazer (ver/responder/tags) segue no Perfil de Acesso.</p>
      </div>
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !salvando && setAddOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">➕ Adicionar novo número</h3>
              <button type="button" onClick={() => !salvando && setAddOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <p className="text-xs text-gray-500">Cria o número na hora e mostra o <b>QR</b> pra conectar o celular — sem sair daqui.</p>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase">Nome do número *</label>
              <input value={nome} onChange={e => setNome(e.target.value)} className={inp} placeholder="Ex.: Sororoca · Clientes" autoFocus
                onKeyDown={e => { if (e.key === "Enter" && nome.trim()) void criar(); }} />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase">Descrição (opcional)</label>
              <input value={descricao} onChange={e => setDescricao(e.target.value)} className={inp} placeholder="Ex.: atendimento a clientes, fornecedores…" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setAddOpen(false)} disabled={salvando} className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Cancelar</button>
              <Button onClick={criar} disabled={salvando || !nome.trim()}>{salvando ? "Criando…" : "Adicionar e conectar"}</Button>
            </div>
          </div>
        </div>
      )}
      {qr && <QrModal instancia={qr.instancia} nome={qr.nome} qrInicial={qr.qr} onClose={() => { setQr(null); void atualizarStatus(); }} />}
    </div>
  );
}

// Card de um número: status colorido, expansível, usuários por chip, botão Salvar.
function NumeroConfigCard({ numero, estado, pessoas, restaurants, onQr, onLogout, onExcluir }: {
  numero: WhatsappNumero; estado: string; pessoas: Pessoa[]; restaurants: { id: string; nome: string }[];
  onQr: () => void; onLogout: () => void; onExcluir: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [buscaU, setBuscaU] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [draft, setDraft] = useState(() => ({ nome: numero.nome, descricao: numero.descricao || "", restaurantIds: numero.restaurantIds || [], usuariosIds: numero.usuariosIds || [], regras: numero.regras || "", ativo: numero.ativo !== false }));
  // Ressincroniza o rascunho quando o doc muda (ex.: depois de salvar).
  useEffect(() => { setDraft({ nome: numero.nome, descricao: numero.descricao || "", restaurantIds: numero.restaurantIds || [], usuariosIds: numero.usuariosIds || [], regras: numero.regras || "", ativo: numero.ativo !== false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numero.id, numero.nome, numero.descricao, (numero.restaurantIds || []).join(","), (numero.usuariosIds || []).join(","), numero.regras, numero.ativo]);

  const eqArr = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
  const dirty = draft.nome !== numero.nome || draft.descricao !== (numero.descricao || "") || !eqArr(draft.restaurantIds, numero.restaurantIds || []) || !eqArr(draft.usuariosIds, numero.usuariosIds || []) || draft.regras !== (numero.regras || "") || draft.ativo !== (numero.ativo !== false);

  const em = ESTADO_META[estado] || { label: "…", cls: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" };
  const cor = estado === "open" ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-900/10"
    : estado === "close" ? "border-rose-300 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-900/10"
    : estado === "connecting" ? "border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/10"
    : "border-gray-200 dark:border-gray-800";
  const pessoaById = Object.fromEntries(pessoas.map(p => [p.id, p]));
  const selecionados = draft.usuariosIds.map(id => pessoaById[id]).filter(Boolean) as Pessoa[];
  const disponiveis = (() => {
    const q = buscaU.trim().toLowerCase();
    return pessoas
      .filter(p => !draft.usuariosIds.includes(p.id))
      .filter(p => { const rs = draft.restaurantIds; return rs.length === 0 || (p.restaurantIds || []).some(r => rs.includes(r)); })
      .filter(p => !q || p.nome.toLowerCase().includes(q))
      .sort((a, b) => a.nome.localeCompare(b.nome)).slice(0, 30);
  })();
  const inp = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";

  async function salvar() { setSalvando(true); try { await setDoc(doc(db, "whatsappNumeros", numero.id), sanitizeForFirestore({ nome: draft.nome.trim() || numero.nome, descricao: draft.descricao.trim() || null, restaurantIds: draft.restaurantIds, usuariosIds: draft.usuariosIds, regras: draft.regras.trim() || null, ativo: draft.ativo, atualizadoEm: new Date().toISOString() }), { merge: true }); } catch (e) { alert("Erro ao salvar: " + (e instanceof Error ? e.message : "?")); } finally { setSalvando(false); } }
  const cancelar = () => setDraft({ nome: numero.nome, descricao: numero.descricao || "", restaurantIds: numero.restaurantIds || [], usuariosIds: numero.usuariosIds || [], regras: numero.regras || "", ativo: numero.ativo !== false });

  return (
    <div className={`rounded-xl border ${cor}`}>
      {/* Cabeçalho do card (clicável) */}
      <button type="button" onClick={() => setAberto(v => !v)} className="w-full text-left p-3.5 flex items-start gap-3">
        <span className={`mt-0.5 w-2.5 h-2.5 rounded-full shrink-0 ${estado === "open" ? "bg-emerald-500" : estado === "close" ? "bg-rose-500" : estado === "connecting" ? "bg-amber-500 animate-pulse" : "bg-gray-300"}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{numero.nome}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${em.cls}`}>{em.label}</span>
            {numero.ativo === false && <span className="text-[10px] text-gray-400">(inativo)</span>}
          </div>
          <div className="text-[11px] text-gray-400 mt-0.5">instância: {numero.id}{numero.descricao ? ` · ${numero.descricao}` : ""}</div>
          {/* Chips de usuários conectados */}
          <div className="flex flex-wrap gap-1 mt-1.5">
            {selecionados.length === 0 && <span className="text-[11px] text-gray-400">Sem usuários atribuídos</span>}
            {selecionados.slice(0, 6).map(p => <span key={p.id} className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/70 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300">{p.nome.split(" ")[0]}</span>)}
            {selecionados.length > 6 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/70 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500">+{selecionados.length - 6}</span>}
          </div>
        </div>
        <span className="text-gray-400 text-sm shrink-0 mt-0.5">{aberto ? "▲" : "▼"}</span>
      </button>

      {aberto && (
        <div className="px-3.5 pb-3.5 border-t border-gray-200/70 dark:border-gray-800 pt-3 space-y-3">
          {/* Conexão */}
          <div className="flex items-center gap-2">
            {estado === "open"
              ? <button type="button" onClick={onLogout} className="text-xs px-2.5 py-1.5 rounded-lg border border-rose-300 dark:border-rose-700 text-rose-600 dark:text-rose-300">⏻ Desconectar</button>
              : <button type="button" onClick={onQr} className="text-xs px-2.5 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-300">{estado === "close" ? "🔄 Reconectar" : "🔌 Conectar"}</button>}
            <button type="button" onClick={onExcluir} className="ml-auto text-xs text-gray-400 hover:text-rose-600">🗑️ Excluir número</button>
          </div>

          {/* Rótulo */}
          <div><label className="text-[11px] font-semibold text-gray-500 uppercase">Rótulo</label>
            <input value={draft.nome} onChange={e => setDraft(d => ({ ...d, nome: e.target.value }))} className={inp} /></div>

          {/* Empresas */}
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase">Empresa(s) deste número</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {restaurants.map(r => { const on = draft.restaurantIds.includes(r.id); return (
                <button key={r.id} type="button" onClick={() => setDraft(d => ({ ...d, restaurantIds: on ? d.restaurantIds.filter(x => x !== r.id) : [...d.restaurantIds, r.id] }))}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border ${on ? "border-indigo-500 bg-indigo-500 text-white" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800"}`}>{on ? "✓ " : ""}{r.nome}</button>
              ); })}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Vazio = qualquer empresa. Trava o número só pra quem é da(s) empresa(s) marcada(s).</p>
          </div>

          {/* Usuários por chip + busca */}
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase">Usuários que podem usar</label>
            <div className="flex flex-wrap gap-1.5 mt-1 mb-1.5">
              {selecionados.length === 0 && <span className="text-[11px] text-gray-400">Ninguém ainda.</span>}
              {selecionados.map(p => (
                <span key={p.id} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  {p.nome}
                  <button type="button" onClick={() => setDraft(d => ({ ...d, usuariosIds: d.usuariosIds.filter(x => x !== p.id) }))} className="opacity-70 hover:opacity-100">✕</button>
                </span>
              ))}
            </div>
            <input value={buscaU} onChange={e => setBuscaU(e.target.value)} className={inp} placeholder="Digite o nome pra adicionar…" />
            {buscaU.trim() && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                {disponiveis.length === 0 && <div className="px-3 py-2 text-sm text-gray-400">Ninguém encontrado.</div>}
                {disponiveis.map(p => (
                  <button key={p.id} type="button" onClick={() => { setDraft(d => ({ ...d, usuariosIds: [...d.usuariosIds, p.id] })); setBuscaU(""); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/40 text-gray-800 dark:text-gray-200">{p.nome}</button>
                ))}
              </div>
            )}
          </div>

          {/* Regras */}
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase">Regras de uso (opcional)</label>
            <textarea value={draft.regras} onChange={e => setDraft(d => ({ ...d, regras: e.target.value }))} rows={2} className={inp} placeholder="Ex.: só responder em horário comercial; confirmar preço antes de fechar…" />
          </div>

          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={draft.ativo} onChange={e => setDraft(d => ({ ...d, ativo: e.target.checked }))} /> Ativo (aparece no inbox)
          </label>

          {/* Salvar / Cancelar */}
          <div className="flex items-center justify-end gap-2 pt-1">
            {dirty && <span className="text-[11px] text-amber-600 dark:text-amber-400 mr-auto">Alterações não salvas</span>}
            {dirty && <button type="button" onClick={cancelar} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Cancelar</button>}
            <Button onClick={() => void salvar()} disabled={!dirty || salvando}>{salvando ? "Salvando…" : "💾 Salvar"}</Button>
          </div>
        </div>
      )}
    </div>
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

// Escolhe um cliente do Reservas+CRM (busca por nome/telefone).
function ClientePicker({ clientes, onChange }: { clientes: Cliente[]; onChange: (id: string) => void }) {
  const [busca, setBusca] = useState("");
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase(); const qd = soDig(busca);
    return [...clientes].sort((a, b) => a.nome.localeCompare(b.nome))
      .filter(c => !q || c.nome.toLowerCase().includes(q) || (!!qd && soDig(c.telefone).includes(qd))).slice(0, 40);
  }, [clientes, busca]);
  return (
    <div className="mt-1">
      <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Vincular a um cliente do CRM…" className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
      {busca.trim() && (
        <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {lista.length === 0 && <div className="px-3 py-2 text-sm text-gray-400">Nenhum cliente encontrado.</div>}
          {lista.map(c => (
            <button key={c.id} type="button" onClick={() => onChange(c.id)} className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/40">
              <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{c.nome}</div>
              {c.telefone && <div className="text-[11px] text-gray-400">{c.telefone}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Transferir conversa pra outro atendente (só quem pode usar o número) + nota.
function TransferModal({ pessoas, atualId, meId, onClose, onTransferir }: { pessoas: Pessoa[]; atualId: string | null; meId: string | null; onClose: () => void; onTransferir: (p: Pessoa, nota: string) => Promise<void> }) {
  const [busca, setBusca] = useState("");
  const [nota, setNota] = useState("");
  const [sel, setSel] = useState<Pessoa | null>(null);
  const lista = useMemo(() => { const q = busca.trim().toLowerCase(); return [...pessoas].sort((a, b) => a.nome.localeCompare(b.nome)).filter(p => p.id !== meId && (!q || p.nome.toLowerCase().includes(q))); }, [pessoas, busca, meId]);
  return (
    <Modal onClose={onClose} title="↪ Transferir conversa" maxWidth="max-w-md">
      <div className="space-y-3">
        {atualId && <p className="text-[11px] text-gray-400">Atualmente com quem você escolher assume a conversa.</p>}
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar atendente…" className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
        <div className="max-h-52 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {lista.length === 0 && <div className="px-3 py-3 text-sm text-gray-400">Nenhum atendente disponível pra este número.</div>}
          {lista.map(p => (
            <button key={p.id} type="button" onClick={() => setSel(p)} className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/40 ${sel?.id === p.id ? "bg-indigo-50 dark:bg-indigo-900/20" : ""}`}>
              {sel?.id === p.id ? "✓ " : ""}{p.nome}
            </button>
          ))}
        </div>
        <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2} placeholder="Nota do repasse (opcional): contexto pro próximo atendente…" className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => sel && void onTransferir(sel, nota.trim())} disabled={!sel}>Transferir{sel ? ` para ${sel.nome.split(" ")[0]}` : ""}</Button>
        </div>
      </div>
    </Modal>
  );
}

function FiltroChip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${ativo ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>{children}</button>
  );
}

// Cadastro das tags (aba Configuração do módulo). Self-contido.
export function TagsManager() {
  const [tags, setTags] = useState<WhatsappTag[]>([]);
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState(PALETA[0]!);
  useEffect(() => {
    const u = onSnapshot(collection(db, "whatsappTags"), snap => setTags(snap.docs.map(d => ({ id: d.id, ...d.data() }) as WhatsappTag).sort((a, b) => a.nome.localeCompare(b.nome))));
    return () => u();
  }, []);
  const criar = async () => { const n = nome.trim(); if (!n) return; await addDoc(collection(db, "whatsappTags"), sanitizeForFirestore({ nome: n, cor, criadoEm: new Date().toISOString() })); setNome(""); };
  const excluir = async (id: string) => { if (confirm("Excluir esta tag?")) await deleteDoc(doc(db, "whatsappTags", id)); };
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3 space-y-3">
      <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">🏷 Tags de conversa</div>
      <p className="text-[11px] text-gray-500">Etiquetas pra organizar as conversas (aplicadas no Chat, dentro de cada conversa).</p>
      <div className="flex flex-wrap gap-2">
        {tags.length === 0 && <span className="text-sm text-gray-400">Nenhuma tag ainda.</span>}
        {tags.map(t => (
          <span key={t.id} className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-full text-white" style={{ background: t.cor || "#6366f1" }}>
            {t.nome}
            <button type="button" onClick={() => void excluir(t.id)} className="opacity-80 hover:opacity-100 leading-none">×</button>
          </span>
        ))}
      </div>
      <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
        <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Nova tag</label>
        <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome da tag" className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100"
          onKeyDown={e => { if (e.key === "Enter") void criar(); }} />
        <div className="flex items-center gap-2 mt-2">
          {PALETA.map(c => (
            <button key={c} type="button" onClick={() => setCor(c)} className={`w-6 h-6 rounded-full ${cor === c ? "ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-900" : ""}`} style={{ background: c }} />
          ))}
          <Button onClick={() => void criar()} disabled={!nome.trim()} size="sm">Adicionar</Button>
        </div>
      </div>
    </div>
  );
}
