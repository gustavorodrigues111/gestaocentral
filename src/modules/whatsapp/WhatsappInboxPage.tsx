// Caixa de entrada do WhatsApp da plataforma. Mostra as conversas recebidas
// (whatsappMensagens, gravadas pelo webhook) e permite responder — texto livre
// funciona dentro da janela de 24h da última mensagem da pessoa; fora disso a
// Meta exige template. Número é único da plataforma (não por restaurante).
//
// Cada conversa (waId) pode ser vinculada a uma Pessoa (auto-match pelo número
// cadastrado) e a um restaurante, além de receber tags. Isso permite dividir a
// caixa por restaurante e filtrar por tag. Metadados em whatsappContatos/{waId}
// e catálogo de tags em whatsappTags.
import { useEffect, useMemo, useRef, useState, type ReactNode, type ChangeEvent, type TouchEvent as RTouchEvent } from "react";
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
import type { Pessoa, WhatsappTag, WhatsappContato, WhatsappNumero, WhatsappResposta, Cliente } from "../../core/types";

type Msg = { id: string; waId: string; nome?: string | null; direcao: "in" | "out"; tipo?: string; texto?: string; timestamp?: string; recebidoEm?: string; lido?: boolean; autorNome?: string | null; numeroId?: string; sistema?: boolean; midia?: string; mime?: string };

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
const EMOJIS = ["😀","😁","😂","🤣","😊","😍","😘","😉","😎","🤗","🤔","😅","🙃","😴","😮","😢","😭","😡","👍","👎","👏","🙏","💪","🤝","👌","✌️","🔥","✨","🎉","❤️","🧡","💛","💚","💙","💜","🖤","💯","✅","❌","⚠️","⭐","📌","📎","📄","📷","🎁","💰","💳","🛵","🍔","🍕","🍟","🥤","☕","🍺","🎂","😋","🤤","👋","🫶","😇","🥳","🤩"];

export function WhatsappInboxPage({ modo = "completo", voltarListaSignal }: { modo?: "conversas" | "completo"; voltarListaSignal?: number } = {}) {
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
  const [respostas, setRespostas] = useState<WhatsappResposta[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [resposta, setResposta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [emojiAberto, setEmojiAberto] = useState(false);
  const [filtroTag, setFiltroTag] = useState<string | null>(null);
  const [filtroAtrib, setFiltroAtrib] = useState<"minhas" | "pendentes" | "todas" | "outros">("pendentes");
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const msgsEndRef = useRef<HTMLDivElement | null>(null);
  const painelRef = useRef<HTMLDivElement | null>(null);
  // iOS: com o teclado aberto, ancora o painel na viewport VISÍVEL pra o
  // cabeçalho não subir pra fora da tela (VisualViewport API).
  useEffect(() => {
    if (!sel) return;
    const vv = window.visualViewport;
    const apply = () => {
      const el = painelRef.current; if (!el) return;
      if (vv) { el.style.height = vv.height + "px"; el.style.transform = `translateY(${vv.offsetTop}px)`; }
    };
    apply();
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    return () => { vv?.removeEventListener("resize", apply); vv?.removeEventListener("scroll", apply); const el = painelRef.current; if (el) { el.style.height = ""; el.style.transform = ""; } };
  }, [sel]);
  // Auto-expande o campo de resposta conforme o texto (até ~5 linhas → rola).
  useEffect(() => {
    const el = taRef.current; if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 132) + "px";
  }, [resposta, sel]);
  // Trava o scroll do fundo enquanto a conversa em tela cheia está aberta.
  useEffect(() => {
    if (!sel) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [sel]);
  // Anexos + gravação de áudio.
  const [anexoMenu, setAnexoMenu] = useState(false);
  const [enviandoMidia, setEnviandoMidia] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [segGrav, setSegGrav] = useState(0);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const gravTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelGravRef = useRef(false);
  const fileMediaRef = useRef<HTMLInputElement | null>(null);
  const fileDocRef = useRef<HTMLInputElement | null>(null);
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
      // Indexa pela chave normalizada (DDD + 8 últimos), pra casar as duas formas
      // do número (com/sem o 9º dígito) no mesmo contato.
      snap.docs.forEach(d => { const data = { id: d.id, ...d.data() } as WhatsappContato; const k = foneKey(d.id); if (!m[k] || (data.atualizadoEm || "") > (m[k].atualizadoEm || "")) m[k] = data; });
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
  useEffect(() => {
    const u = onSnapshot(collection(db, "whatsappRespostas"), snap =>
      setRespostas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as WhatsappResposta)));
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
    const c = contatos[foneKey(waId)];
    if (c?.pessoaId) return pessoaById[c.pessoaId] || null;
    return pessoaByFone[foneKey(waId)] || null;
  }
  // Resolve Cliente (CRM) vinculado (manual tem prioridade sobre auto-match por telefone).
  function clienteDaConversa(waId: string): Cliente | null {
    const c = contatos[foneKey(waId)];
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
  // Clique na aba "Chat" (no topo) → volta pra lista de todas as conversas.
  useEffect(() => { if (voltarListaSignal) setSel(null); }, [voltarListaSignal]);

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
  // Agrupa por chave normalizada (foneKey) — junta as duas formas do mesmo
  // número (com/sem o 9º dígito) numa conversa só. waId = número mais recente.
  const conversas = useMemo(() => {
    const m = new Map<string, { waId: string; nome?: string | null; ultima: Msg; naoLidas: number }>();
    for (const msg of msgsDoNumero) {
      const k = foneKey(msg.waId);
      const c = m.get(k) || { waId: msg.waId, nome: msg.nome, ultima: msg, naoLidas: 0 };
      c.ultima = msg; c.waId = msg.waId; if (msg.nome) c.nome = msg.nome;   // msgsDoNumero está em ordem asc → fica o mais recente
      m.set(k, c);
    }
    for (const msg of msgsDoNumero) if (msg.direcao === "in" && !msg.lido) { const c = m.get(foneKey(msg.waId)); if (c) c.naoLidas++; }
    return [...m.values()].sort((a, b) => (b.ultima.timestamp || "").localeCompare(a.ultima.timestamp || ""));
  }, [msgsDoNumero]);

  const nomeConversa = (waId: string, waNome?: string | null) =>
    contatos[foneKey(waId)]?.nomeManual || pessoaDaConversa(waId)?.nome || waNome || foneBonito(waId);

  // Dono (responsável) de uma conversa, pela chave normalizada.
  const donoDe = (waId: string): string | null => contatos[foneKey(waId)]?.atribuidoA || null;
  // Contadores por atribuição (pra chips).
  const contMinhas = useMemo(() => conversas.filter(c => donoDe(c.waId) === me?.id).length, [conversas, contatos, me?.id]);
  const contPend = useMemo(() => conversas.filter(c => !donoDe(c.waId)).length, [conversas, contatos]);
  const contOutros = useMemo(() => conversas.filter(c => { const d = donoDe(c.waId); return d && d !== me?.id; }).length, [conversas, contatos, me?.id]);

  // Filtro por atribuição + tag (o número já é da empresa; não filtra por empresa aqui).
  const conversasFiltradas = useMemo(() => conversas.filter(c => {
    if (filtroTag) { if (!(contatos[foneKey(c.waId)]?.tagIds || []).includes(filtroTag)) return false; }
    const dono = donoDe(c.waId);
    if (filtroAtrib === "minhas" && dono !== me?.id) return false;
    if (filtroAtrib === "pendentes" && dono) return false;
    if (filtroAtrib === "outros" && (!dono || dono === me?.id)) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [conversas, filtroTag, contatos, filtroAtrib, me?.id]);

  const thread = useMemo(() => msgsDoNumero.filter(x => foneKey(x.waId) === foneKey(sel || "")), [msgsDoNumero, sel]);
  // Rola pro fim ao abrir a conversa ou chegar mensagem nova.
  useEffect(() => { const t = setTimeout(() => msgsEndRef.current?.scrollIntoView({ block: "end" }), 50); return () => clearTimeout(t); }, [sel, thread.length]);
  const nomeSel = sel ? nomeConversa(sel, conversas.find(c => foneKey(c.waId) === foneKey(sel))?.nome) : "";

  // Marca recebidas como lidas ao abrir + limpa a flag manual de não-lida.
  useEffect(() => {
    if (!sel) return;
    for (const m of msgs) if (foneKey(m.waId) === foneKey(sel) && m.direcao === "in" && !m.lido) void updateDoc(doc(db, "whatsappMensagens", m.id), { lido: true }).catch(() => {});
    if (contatos[foneKey(sel)]?.naoLidaManual) void salvarContato(sel, { naoLidaManual: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, msgs]);

  // ── Writers ──────────────────────────────────────────────────────────────
  async function salvarContato(waId: string, patch: Partial<WhatsappContato>) {
    // Doc keyed pela chave normalizada (DDD + 8 últimos) → tags/vínculos casam
    // com/sem o 9º dígito. Guarda o waId cru pra referência.
    const k = foneKey(waId);
    await setDoc(doc(db, "whatsappContatos", k), sanitizeForFirestore({ ...patch, id: k, waId, atualizadoEm: new Date().toISOString(), atualizadoPor: me?.id || null }), { merge: true });
  }
  async function toggleTagConversa(waId: string, tagId: string) {
    const atuais = contatos[foneKey(waId)]?.tagIds || [];
    const novas = atuais.includes(tagId) ? atuais.filter(t => t !== tagId) : [...atuais, tagId];
    await salvarContato(waId, { tagIds: novas });
  }

  // Marca a conversa como NÃO lida (flag no contato — robusto até sem mensagem
  // recebida, ex.: conversa comigo mesmo) e volta pra lista.
  async function marcarNaoLida(waId: string) {
    setSel(null);
    await salvarContato(waId, { naoLidaManual: true });
  }
  // Marca como LIDA: limpa a flag manual e zera as recebidas não-lidas.
  async function marcarLida(waId: string) {
    await salvarContato(waId, { naoLidaManual: false });
    for (const m of msgsDoNumero) if (foneKey(m.waId) === foneKey(waId) && m.direcao === "in" && !m.lido) void updateDoc(doc(db, "whatsappMensagens", m.id), { lido: true }).catch(() => {});
  }

  async function responder() {
    const txt = resposta.trim();
    if (!txt || !sel || !numeroSel) return;
    // Assume a conversa pra mim ao responder (se declinar assumir de outro, aborta).
    if (!(await assumirConversa(sel))) return;
    // Responde no número que o cliente REALMENTE usou por último (com/sem o 9º
    // dígito), não numa forma normalizada que poderia não existir.
    const inbound = thread.filter(m => m.direcao === "in");
    const paraEnviar = inbound.length ? inbound[inbound.length - 1].waId : sel;
    setEnviando(true);
    try {
      const r = await fetch("/api/evolution-enviar", {
        method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ instancia: numeroSel, to: paraEnviar, texto: txt, autorNome: me?.nome || "" }),
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

  // ── Mídia: foto/vídeo/documento/áudio ──────────────────────────────────────
  async function enviarMidia(tipo: "image" | "video" | "document" | "audio", dataUrl: string, fileName: string, mimetype: string, caption = "") {
    if (!sel || !numeroSel) return;
    if (!(await assumirConversa(sel))) return;
    const inbound = thread.filter(m => m.direcao === "in");
    const paraEnviar = inbound.length ? inbound[inbound.length - 1].waId : sel;
    setEnviandoMidia(true);
    try {
      const r = await fetch("/api/evolution-enviar-midia", {
        method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ instancia: numeroSel, to: paraEnviar, tipo, base64: dataUrl, mimetype, fileName, caption, autorNome: me?.nome || "" }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && (j as { ok?: boolean }).ok) {
        const tipoMsg = tipo === "image" ? "imageMessage" : tipo === "video" ? "videoMessage" : tipo === "audio" ? "audioMessage" : "documentMessage";
        const rotulo = caption || (tipo === "image" ? "🖼️ Imagem" : tipo === "video" ? "🎬 Vídeo" : tipo === "audio" ? "🎤 Áudio" : `📄 ${fileName}`);
        const guardaMidia = dataUrl.length <= 900_000;   // ~675KB cabe no doc do Firestore
        await addDoc(collection(db, "whatsappMensagens"), sanitizeForFirestore({
          waId: sel, nome: nomeSel || null, direcao: "out", tipo: tipoMsg, texto: rotulo,
          timestamp: new Date().toISOString(), recebidoEm: new Date().toISOString(), lido: true,
          numeroId: numeroSel, autorNome: me?.nome || null, autorId: me?.id || null,
          ...(guardaMidia ? { midia: dataUrl, mime: mimetype } : {}),
        }));
      } else {
        alert((j as { naoConfigurado?: boolean }).naoConfigurado ? "Evolution ainda não configurada (env vars na Vercel)." : ((j as { error?: string }).error || "Falha ao enviar mídia."));
      }
    } catch (e) { alert("Falha ao enviar mídia: " + (e instanceof Error ? e.message : "?")); }
    setEnviandoMidia(false);
  }

  function onArquivo(e: ChangeEvent<HTMLInputElement>, forcarDoc: boolean) {
    const f = e.target.files?.[0]; e.target.value = "";
    setAnexoMenu(false);
    if (!f) return;
    if (f.size > 16 * 1024 * 1024) { alert("Arquivo muito grande (máximo 16 MB)."); return; }
    const tipo: "image" | "video" | "document" = forcarDoc ? "document" : f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : "document";
    const reader = new FileReader();
    reader.onload = () => void enviarMidia(tipo, String(reader.result || ""), f.name, f.type);
    reader.readAsDataURL(f);
  }

  async function iniciarGravacao() {
    setAnexoMenu(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = []; cancelGravRef.current = false;
      mr.ondataavailable = ev => { if (ev.data.size) chunksRef.current.push(ev.data); };
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (cancelGravRef.current) { cancelGravRef.current = false; return; }
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        const reader = new FileReader();
        reader.onload = () => void enviarMidia("audio", String(reader.result || ""), "audio", blob.type);
        reader.readAsDataURL(blob);
      };
      mediaRecRef.current = mr; mr.start(); setGravando(true); setSegGrav(0);
      gravTimerRef.current = setInterval(() => setSegGrav(s => s + 1), 1000);
    } catch { alert("Não foi possível acessar o microfone. Autorize o acesso no navegador."); }
  }
  function pararGravacao(enviar: boolean) {
    if (gravTimerRef.current) { clearInterval(gravTimerRef.current); gravTimerRef.current = null; }
    setGravando(false);
    const mr = mediaRecRef.current; mediaRecRef.current = null;
    if (!mr) return;
    cancelGravRef.current = !enviar;
    try { mr.stop(); } catch { /* ignore */ }
  }

  if (!podeVer && !embutido) return <div className="max-w-2xl mx-auto py-12 text-center"><div className="text-4xl mb-3">🔒</div><p className="text-gray-700 dark:text-gray-300 font-medium">Sem acesso à caixa de entrada do WhatsApp.</p></div>;

  // Respostas rápidas do número selecionado + picker acionado por "/" no campo.
  const respostasNum = respostas.filter(r => r.numeroId === numeroSel);
  const slashAtivo = resposta.startsWith("/");
  const slashQ = slashAtivo ? resposta.slice(1).toLowerCase().trim() : "";
  const respostasFiltradas = slashAtivo
    ? respostasNum.filter(r => !slashQ || (r.atalho || "").toLowerCase().includes(slashQ) || r.texto.toLowerCase().includes(slashQ))
    : [];

  const contatoSel = sel ? contatos[foneKey(sel)] : undefined;
  const pessoaSel = sel ? pessoaDaConversa(sel) : null;
  const autoMatch = sel ? pessoaByFone[foneKey(sel)] : null;
  const clienteSel = sel ? clienteDaConversa(sel) : null;
  const clienteAuto = sel ? clienteByFone[foneKey(sel)] : null;
  const [transferir, setTransferir] = useState(false);
  const [transferWaId, setTransferWaId] = useState<string | null>(null);

  // Vincular/desvincular cliente do CRM.
  async function vincularCliente(clienteId: string | null) { if (sel) await salvarContato(sel, { clienteId }); }
  // Transferir a conversa pra outro atendente (+ registra no histórico).
  async function transferirPara(p: Pessoa, nota: string) {
    const alvo = transferWaId || sel;
    if (!alvo) return;
    await salvarContato(alvo, { atribuidoA: p.id, atribuidoNome: p.nome });
    await addDoc(collection(db, "whatsappMensagens"), sanitizeForFirestore({
      waId: alvo, numeroId: numeroSel, direcao: "out", tipo: "sistema", sistema: true, lido: true,
      texto: `🔀 Conversa transferida para ${p.nome} por ${me?.nome || "—"}${nota ? ` — ${nota}` : ""}`,
      timestamp: new Date().toISOString(), recebidoEm: new Date().toISOString(), autorNome: me?.nome || null,
    }));
    setTransferir(false); setTransferWaId(null);
  }

  // Assume a conversa pra mim (avisa se já for de outro). Retorna se pode seguir.
  async function assumirConversa(waId: string, silencioso = false): Promise<boolean> {
    const c = contatos[foneKey(waId)];
    const dono = c?.atribuidoA || null;
    if (dono === me?.id) return true;                       // já é minha
    if (dono && !silencioso) { if (!confirm(`Essa conversa é de ${c?.atribuidoNome || "outra pessoa"}. Assumir mesmo assim?`)) return false; }
    await salvarContato(waId, { atribuidoA: me?.id || null, atribuidoNome: me?.nome || null });
    await addDoc(collection(db, "whatsappMensagens"), sanitizeForFirestore({
      waId, numeroId: numeroSel, direcao: "out", tipo: "sistema", sistema: true, lido: true,
      texto: `🙋 ${me?.nome || "—"} assumiu a conversa`, timestamp: new Date().toISOString(), recebidoEm: new Date().toISOString(), autorNome: me?.nome || null,
    }));
    return true;
  }
  async function liberarConversa(waId: string) {
    if (!confirm("Liberar esta conversa? Ela volta pra fila de pendentes (sem responsável).")) return;
    await salvarContato(waId, { atribuidoA: null, atribuidoNome: null });
    await addDoc(collection(db, "whatsappMensagens"), sanitizeForFirestore({
      waId, numeroId: numeroSel, direcao: "out", tipo: "sistema", sistema: true, lido: true,
      texto: `↩️ ${me?.nome || "—"} liberou a conversa (voltou pra pendentes)`, timestamp: new Date().toISOString(), recebidoEm: new Date().toISOString(), autorNome: me?.nome || null,
    }));
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

          {/* Filtro por atribuição */}
          {numerosVisiveis.length > 0 && (
            <div className="flex flex-nowrap gap-1.5 mb-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <FiltroChip ativo={filtroAtrib === "pendentes"} onClick={() => setFiltroAtrib("pendentes")}>⏳ Pendentes{contPend ? ` (${contPend})` : ""}</FiltroChip>
              <FiltroChip ativo={filtroAtrib === "minhas"} onClick={() => setFiltroAtrib("minhas")}>🙋 Minhas{contMinhas ? ` (${contMinhas})` : ""}</FiltroChip>
              <FiltroChip ativo={filtroAtrib === "todas"} onClick={() => setFiltroAtrib("todas")}>Todas</FiltroChip>
              {isMaster && <FiltroChip ativo={filtroAtrib === "outros"} onClick={() => setFiltroAtrib("outros")}>De outros{contOutros ? ` (${contOutros})` : ""}</FiltroChip>}
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
          <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">{conversas.length === 0 ? "Nenhuma mensagem recebida ainda. Quando alguém mandar no WhatsApp do planejamento.app, aparece aqui." : filtroAtrib === "pendentes" ? "🎉 Nenhuma conversa pendente — tudo atribuído." : filtroAtrib === "minhas" ? "Você não tem conversas atribuídas." : "Nenhuma conversa nesse filtro."}</div>
        ) : (
          <div className="relative left-1/2 w-screen -ml-[50vw] border-y border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {conversasFiltradas.map(c => {
              const cont = contatos[foneKey(c.waId)];
              const cTags = (cont?.tagIds || []).map(id => tagById[id]).filter(Boolean) as WhatsappTag[];
              const naoLida = c.naoLidas > 0 || !!cont?.naoLidaManual;
              const atribuido = cont?.atribuidoNome;
              return (
                <ConversaItem key={c.waId} naoLida={naoLida} temDono={!!donoDe(c.waId)}
                  onAbrir={() => { setSel(c.waId); setDetalhes(false); }}
                  onNaoLida={() => void marcarNaoLida(c.waId)}
                  onLida={() => void marcarLida(c.waId)}
                  onTransferir={() => { setTransferWaId(c.waId); setTransferir(true); }}
                  podeResponder={podeResponder}>
                  <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center text-lg shrink-0">💬</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`truncate ${naoLida ? "font-bold text-gray-900 dark:text-gray-50" : "font-medium text-gray-900 dark:text-gray-100"}`}>{nomeConversa(c.waId, c.nome)}</span>
                      {cTags.map(t => <span key={t.id} className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: t.cor || "#6366f1" }} title={t.nome} />)}
                    </div>
                    <div className={`text-xs truncate ${naoLida ? "text-gray-700 dark:text-gray-200 font-medium" : "text-gray-500"}`}>{c.ultima.direcao === "out" ? "Você: " : ""}{c.ultima.texto || `[${c.ultima.tipo || "msg"}]`}</div>
                    {atribuido && <div className="text-[10px] text-indigo-500 dark:text-indigo-300 truncate">🙋 {atribuido}</div>}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[10px] text-gray-400">{hhmm(c.ultima.timestamp)}</span>
                    {naoLida && <span className="min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center text-[10px] font-bold rounded-full bg-rose-500 text-white">{c.naoLidas > 0 ? c.naoLidas : ""}</span>}
                  </div>
                </ConversaItem>
              );
            })}
          </div>
        )
      ) : (
        <>
        {/* Conversa em tela cheia: só o chat, compose fixo embaixo, sem rolagem dupla */}
        <div ref={painelRef} className="fixed left-0 right-0 top-0 z-40 h-[100dvh] bg-white dark:bg-gray-950 flex flex-col">
          {/* Header compacto */}
          <div className="flex items-center gap-1 px-1.5 py-1.5 border-b border-gray-200 dark:border-gray-800 shrink-0">
            <button type="button" onClick={() => setSel(null)} className="w-9 h-9 rounded-full text-xl text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center shrink-0" title="Voltar às conversas">←</button>
            <div className="flex-1 min-w-0 leading-tight">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{nomeSel}</div>
              <div className="text-[11px] text-gray-400 truncate">
                {foneBonito(sel)}
                {clienteSel && <span className="text-emerald-600 dark:text-emerald-300"> · 🧑 {clienteSel.nome}</span>}
                {pessoaSel && <span className="text-indigo-600 dark:text-indigo-300"> · 👤 {pessoaSel.nome}</span>}
                {contatoSel?.atribuidoNome && <span> · 🙋 {contatoSel.atribuidoNome}</span>}
              </div>
            </div>
            {podeResponder && <button type="button" onClick={() => { setTransferWaId(null); setTransferir(true); }} title={contatoSel?.atribuidoA ? "Transferir" : "Atribuir"} className="w-9 h-9 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center shrink-0">↪</button>}
            <button type="button" onClick={() => marcarNaoLida(sel)} title="Marcar como não lida" className="w-9 h-9 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center shrink-0">🔵</button>
            {podeVincular && <button type="button" onClick={() => setDetalhes(v => !v)} title="Detalhes" className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${detalhes ? "text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30" : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"}`}>ⓘ</button>}
          </div>

          {/* Barra de atribuição (responsável) */}
          {(() => {
            const dono = contatoSel?.atribuidoA || null;
            const minha = dono === me?.id;
            return (
              <div className={`flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-800 text-xs shrink-0 ${!dono ? "bg-amber-50 dark:bg-amber-900/20" : minha ? "bg-emerald-50 dark:bg-emerald-900/20" : "bg-gray-50 dark:bg-gray-800/40"}`}>
                <span className="truncate">
                  {!dono ? <span className="text-amber-700 dark:text-amber-300">⏳ Pendente — sem responsável</span>
                    : minha ? <span className="text-emerald-700 dark:text-emerald-300">🙋 Atribuída a <b>você</b></span>
                    : <span className="text-gray-600 dark:text-gray-300">🙋 Atribuída a <b>{contatoSel?.atribuidoNome}</b></span>}
                </span>
                {podeResponder && (
                  <div className="ml-auto shrink-0 flex items-center gap-1.5">
                    {minha
                      ? <>
                          <button type="button" onClick={() => { setTransferWaId(null); setTransferir(true); }} className="px-2.5 py-1 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300">↪ Transferir</button>
                          <button type="button" onClick={() => void liberarConversa(sel)} className="px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Liberar</button>
                        </>
                      : <>
                          <button type="button" onClick={() => void assumirConversa(sel)} className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-medium">Assumir</button>
                          <button type="button" onClick={() => { setTransferWaId(null); setTransferir(true); }} className="px-2.5 py-1 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300">{dono ? "↪ Transferir" : "🙋 Atribuir"}</button>
                        </>}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Painel de detalhes: vínculo + restaurante + tags */}
          {detalhes && podeVincular && (
            <div className="px-3 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30 space-y-3 text-sm max-h-[45vh] overflow-y-auto shrink-0">
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
                <div className={`max-w-[80%] rounded-2xl px-2.5 py-1.5 text-sm shadow-sm ${m.direcao === "out" ? "bg-[#dcf8c6] dark:bg-emerald-900/40 text-gray-900 dark:text-gray-100 rounded-br-md" : "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-md"}`}>
                  {m.direcao === "out" && m.autorNome && <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 mb-0.5">{m.autorNome}</div>}
                  {(() => {
                    const isImg = m.midia && (m.mime?.startsWith("image") || m.tipo === "stickerMessage");
                    const isVid = m.midia && (m.mime?.startsWith("video") || m.tipo === "videoMessage");
                    const isAud = m.midia && (m.mime?.startsWith("audio") || m.tipo === "audioMessage");
                    const isDoc = m.midia && m.tipo === "documentMessage";
                    const rotuloAuto = ["🖼️ Imagem", "🎬 Vídeo", "🎤 Áudio"].includes(m.texto || "");
                    return (
                      <>
                        {isImg && <img src={m.midia} alt={m.texto || "imagem"} className={`rounded-lg ${m.tipo === "stickerMessage" ? "w-32 h-32 object-contain" : "max-w-full max-h-64 object-contain"}`} />}
                        {isVid && <video src={m.midia} controls className="rounded-lg max-w-full max-h-64" />}
                        {isAud && <audio src={m.midia} controls className="max-w-[220px]" />}
                        {isDoc && <a href={m.midia} download className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 underline">📄 {m.texto?.replace(/^📄 /, "") || "documento"}</a>}
                        {!isImg && !isVid && !isAud && !isDoc && <div className="whitespace-pre-wrap break-words">{m.texto || `[${m.tipo || "msg"}]`}</div>}
                        {(isImg || isVid) && m.texto && !rotuloAuto && <div className="whitespace-pre-wrap break-words mt-1">{m.texto}</div>}
                      </>
                    );
                  })()}
                  <div className="text-[10px] text-gray-400 mt-0.5 text-right">{hhmm(m.timestamp)}{m.direcao === "out" ? " ✓✓" : ""}</div>
                </div>
              </div>
            ))}
            <div ref={msgsEndRef} />
          </div>

          {/* Resposta */}
          {podeResponder && (
            <div className="border-t border-gray-200 dark:border-gray-800 p-2 relative shrink-0">
              {slashAtivo && (
                <div className="absolute bottom-full left-2 right-2 mb-1 max-h-56 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg z-10">
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-400 border-b border-gray-100 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900">⚡ Respostas rápidas{slashQ ? ` · "${slashQ}"` : ""}</div>
                  {respostasFiltradas.length === 0 && (
                    <div className="px-3 py-3 text-sm text-gray-400">{respostasNum.length === 0 ? "Nenhuma resposta cadastrada pra este número. Cadastre em ⚙️ Configuração." : "Nada encontrado."}</div>
                  )}
                  {respostasFiltradas.map(r => (
                    <button key={r.id} type="button" onClick={() => { setResposta(r.texto); setEmojiAberto(false); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                      {r.atalho && <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">/{r.atalho}</div>}
                      <div className="text-sm text-gray-700 dark:text-gray-200 line-clamp-2 whitespace-pre-wrap">{r.texto}</div>
                    </button>
                  ))}
                </div>
              )}
              {emojiAberto && (
                <div className="absolute bottom-full left-2 mb-1 w-64 max-h-44 overflow-y-auto p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg grid grid-cols-8 gap-0.5 z-10">
                  {EMOJIS.map(e => (
                    <button key={e} type="button" onClick={() => { setResposta(r => r + e); }} className="text-xl leading-none p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">{e}</button>
                  ))}
                </div>
              )}
              {/* Menu de anexos */}
              {anexoMenu && !gravando && (
                <div className="absolute bottom-full left-2 mb-1 w-52 p-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg z-10">
                  <button type="button" onClick={() => fileMediaRef.current?.click()} className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-700 dark:text-gray-200">🖼️ Foto ou vídeo</button>
                  <button type="button" onClick={() => fileDocRef.current?.click()} className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-700 dark:text-gray-200">📄 Documento</button>
                  <button type="button" onClick={() => void iniciarGravacao()} className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-700 dark:text-gray-200">🎤 Gravar áudio</button>
                </div>
              )}
              <input ref={fileMediaRef} type="file" accept="image/*,video/*" className="hidden" onChange={e => onArquivo(e, false)} />
              <input ref={fileDocRef} type="file" className="hidden" onChange={e => onArquivo(e, true)} />

              {gravando ? (
                /* Barra de gravação de áudio */
                <div className="flex items-center gap-3 px-2 py-1.5">
                  <span className="w-3 h-3 rounded-full bg-rose-500 animate-pulse shrink-0" />
                  <span className="text-sm text-gray-600 dark:text-gray-300 flex-1">Gravando… {Math.floor(segGrav / 60)}:{String(segGrav % 60).padStart(2, "0")}</span>
                  <button type="button" onClick={() => pararGravacao(false)} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Cancelar</button>
                  <button type="button" onClick={() => pararGravacao(true)} className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0" title="Enviar áudio">➤</button>
                </div>
              ) : (
                <div className="flex items-end gap-1.5">
                  <button type="button" onClick={() => { setAnexoMenu(v => !v); setEmojiAberto(false); }} disabled={enviandoMidia} className="shrink-0 w-10 h-10 rounded-full text-2xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center leading-none" title="Anexar">{enviandoMidia ? "⏳" : "＋"}</button>
                  <div className="flex-1 flex items-end rounded-3xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 pl-1 pr-2 min-h-[40px]">
                    <button type="button" onClick={() => { setEmojiAberto(v => !v); setAnexoMenu(false); }} className="shrink-0 w-9 h-9 text-xl text-gray-500 hover:text-gray-700 flex items-center justify-center leading-none" title="Emojis">😊</button>
                    <textarea ref={taRef} value={resposta} onChange={e => setResposta(e.target.value)} onFocus={() => { setEmojiAberto(false); setAnexoMenu(false); }} rows={1} placeholder="Mensagem" className="flex-1 py-2 text-base leading-snug bg-transparent resize-none overflow-y-auto outline-none border-0" onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !slashAtivo) { e.preventDefault(); void responder(); } }} />
                  </div>
                  {resposta.trim()
                    ? <button type="button" onClick={() => { setEmojiAberto(false); void responder(); }} disabled={enviando} className="shrink-0 w-10 h-10 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center text-base" title="Enviar">{enviando ? "…" : "➤"}</button>
                    : <button type="button" onClick={() => void iniciarGravacao()} disabled={enviandoMidia} className="shrink-0 w-10 h-10 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center text-lg" title="Gravar áudio">🎤</button>}
                </div>
              )}
            </div>
          )}
        </div>
        </>
      )}

      </>
      )}

      {novaConversa && <NovaConversaModal pessoas={pessoas} onClose={() => setNovaConversa(false)}
        onAbrir={(waId, pid) => { setNovaConversa(false); setSel(waId); if (pid) void salvarContato(waId, { pessoaId: pid }); }} />}
      {transferir && (transferWaId || sel) && <TransferModal
        pessoas={pessoas.filter(p => { const n = numeros.find(x => x.id === numeroSel); const uids = n?.usuariosIds || []; return uids.length === 0 || uids.includes(p.id); })}
        modo={donoDe(transferWaId || sel || "") ? "transferir" : "atribuir"}
        meId={me?.id || null} onClose={() => { setTransferir(false); setTransferWaId(null); }} onTransferir={transferirPara} />}
      {qrRecon && <QrModal instancia={qrRecon.instancia} nome={qrRecon.nome} qrInicial={null}
        onClose={() => { setQrRecon(null); if (numeroSel) void chamarInstancia("status", numeroSel).then(r => setStatusConexao(r.estado || "unknown")).catch(() => {}); }} />}
    </div>
  );
}

// Item da lista de conversas com "arrastar pro lado" revelando ações
// (marcar não lida / transferir), estilo apps de mensagem.
function ConversaItem({ naoLida, temDono, onAbrir, onNaoLida, onLida, onTransferir, podeResponder, children }: {
  naoLida: boolean; temDono: boolean; onAbrir: () => void; onNaoLida: () => void; onLida: () => void; onTransferir: () => void; podeResponder: boolean; children: ReactNode;
}) {
  const MAX = podeResponder ? 152 : 80;   // largura das ações reveladas
  const [dx, setDx] = useState(0);
  const [aberto, setAberto] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const startX = useRef(0); const startY = useRef(0);
  const horizontal = useRef(false); const decidiu = useRef(false); const moveu = useRef(false);

  function onTouchStart(e: RTouchEvent) { const t = e.touches[0]; startX.current = t.clientX; startY.current = t.clientY; horizontal.current = false; decidiu.current = false; moveu.current = false; setArrastando(true); }
  function onTouchMove(e: RTouchEvent) {
    const t = e.touches[0]; const dX = t.clientX - startX.current; const dY = t.clientY - startY.current;
    if (!decidiu.current && (Math.abs(dX) > 6 || Math.abs(dY) > 6)) { decidiu.current = true; horizontal.current = Math.abs(dX) > Math.abs(dY); }
    if (horizontal.current) { moveu.current = true; const base = aberto ? MAX : 0; setDx(Math.max(0, Math.min(MAX, base + dX))); }
  }
  function onTouchEnd() { setArrastando(false); if (!horizontal.current) return; const abrir = dx > MAX / 2; setAberto(abrir); setDx(abrir ? MAX : 0); }
  function fechar() { setAberto(false); setDx(0); }

  return (
    <div className="relative overflow-hidden">
      {/* Ações reveladas atrás (à esquerda) */}
      <div className="absolute inset-y-0 left-0 flex" style={{ width: MAX }}>
        {naoLida
          ? <button type="button" onClick={() => { onLida(); fechar(); }} className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-gray-500 text-white text-[11px] font-medium"><span className="text-base">✓</span>Lida</button>
          : <button type="button" onClick={() => { onNaoLida(); fechar(); }} className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-blue-500 text-white text-[11px] font-medium"><span className="text-base">🔵</span>Não lida</button>}
        {podeResponder && <button type="button" onClick={() => { onTransferir(); fechar(); }} className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-indigo-500 text-white text-[11px] font-medium"><span className="text-base">{temDono ? "↪" : "🙋"}</span>{temDono ? "Transferir" : "Atribuir"}</button>}
      </div>
      {/* Linha (frente) — arrasta pra revelar */}
      <button type="button"
        onClick={() => { if (aberto) { fechar(); return; } if (moveu.current) { moveu.current = false; return; } onAbrir(); }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={{ transform: `translateX(${dx}px)`, touchAction: "pan-y", transition: arrastando ? "none" : "transform 0.2s" }}
        className={`relative w-full text-left flex items-center gap-3 px-4 py-3 ${naoLida ? "bg-rose-50 dark:bg-rose-900/20" : "bg-white dark:bg-gray-900"}`}>
        {children}
      </button>
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
        <Button className="w-full" onClick={() => { setNome(""); setInstancia(""); setDescricao(""); setAddOpen(true); }}>➕ Adicionar novo número</Button>

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
// Painel-seção interno do card (título + conteúdo), pra dividir visualmente.
function SecaoCfg({ icon, titulo, hint, children }: { icon?: string; titulo?: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200/80 dark:border-gray-800 bg-white/60 dark:bg-gray-900/30 p-3 space-y-2">
      {titulo && (
        <div className="flex items-center gap-1.5">
          {icon && <span className="text-sm leading-none">{icon}</span>}
          <span className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wide">{titulo}</span>
          {hint && <span className="text-[10px] text-gray-400 normal-case font-normal">· {hint}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

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
        <div className="border-t border-gray-200/70 dark:border-gray-800">
          <div className="p-3 space-y-2.5">

          {/* Conexão */}
          <SecaoCfg icon="🔌" titulo="Conexão">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${em.cls}`}>{em.label}</span>
              {estado === "open"
                ? <button type="button" onClick={onLogout} className="text-xs px-2.5 py-1.5 rounded-lg border border-rose-300 dark:border-rose-700 text-rose-600 dark:text-rose-300">⏻ Desconectar</button>
                : <button type="button" onClick={onQr} className="text-xs px-2.5 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-300">{estado === "close" ? "🔄 Reconectar" : "🔌 Conectar"}</button>}
            </div>
          </SecaoCfg>

          {/* Identificação */}
          <SecaoCfg icon="🏷️" titulo="Identificação">
            <div><label className="text-[11px] text-gray-500">Rótulo</label>
              <input value={draft.nome} onChange={e => setDraft(d => ({ ...d, nome: e.target.value }))} className={inp} /></div>
            <div><label className="text-[11px] text-gray-500">Descrição (opcional)</label>
              <input value={draft.descricao} onChange={e => setDraft(d => ({ ...d, descricao: e.target.value }))} className={inp} placeholder="Ex.: atendimento a clientes" /></div>
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 pt-0.5">
              <input type="checkbox" checked={draft.ativo} onChange={e => setDraft(d => ({ ...d, ativo: e.target.checked }))} /> Ativo (aparece no inbox)
            </label>
          </SecaoCfg>

          {/* Acesso: empresas + usuários */}
          <SecaoCfg icon="🔒" titulo="Acesso" hint="quem enxerga/usa este número">
            <div>
              <label className="text-[11px] text-gray-500">Empresa(s) deste número</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {restaurants.map(r => { const on = draft.restaurantIds.includes(r.id); return (
                  <button key={r.id} type="button" onClick={() => setDraft(d => ({ ...d, restaurantIds: on ? d.restaurantIds.filter(x => x !== r.id) : [...d.restaurantIds, r.id] }))}
                    className={`text-xs font-medium px-3 py-1.5 rounded-full border ${on ? "border-indigo-500 bg-indigo-500 text-white" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800"}`}>{on ? "✓ " : ""}{r.nome}</button>
                ); })}
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Vazio = qualquer empresa.</p>
            </div>
            <div className="pt-1">
              <label className="text-[11px] text-gray-500">Usuários que podem usar</label>
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
          </SecaoCfg>

          {/* Regras */}
          <SecaoCfg icon="📋" titulo="Regras de uso" hint="opcional">
            <textarea value={draft.regras} onChange={e => setDraft(d => ({ ...d, regras: e.target.value }))} rows={2} className={inp} placeholder="Ex.: só responder em horário comercial; confirmar preço antes de fechar…" />
          </SecaoCfg>

          {/* Respostas rápidas deste número */}
          <SecaoCfg>
            <RespostasNumero numeroId={numero.id} />
          </SecaoCfg>

          {/* Zona de perigo */}
          <div className="flex justify-end pt-0.5">
            <button type="button" onClick={onExcluir} className="text-xs text-gray-400 hover:text-rose-600">🗑️ Excluir número</button>
          </div>
          </div>

          {/* Barra de salvar (rodapé) */}
          <div className="flex items-center justify-end gap-2 px-3 py-2.5 border-t border-gray-200/70 dark:border-gray-800 bg-white/70 dark:bg-gray-900/50 rounded-b-xl">
            {dirty && <span className="text-[11px] text-amber-600 dark:text-amber-400 mr-auto">● Alterações não salvas</span>}
            {dirty && <button type="button" onClick={cancelar} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Cancelar</button>}
            <Button onClick={() => void salvar()} disabled={!dirty || salvando}>{salvando ? "Salvando…" : "💾 Salvar"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Cadastro das respostas rápidas (mensagens pré-cadastradas) de um número.
function RespostasNumero({ numeroId }: { numeroId: string }) {
  const { pessoa: me } = useAuth();
  const [itens, setItens] = useState<WhatsappResposta[]>([]);
  const [atalho, setAtalho] = useState("");
  const [texto, setTexto] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => {
    const u = onSnapshot(collection(db, "whatsappRespostas"), snap =>
      setItens(snap.docs.map(d => ({ id: d.id, ...d.data() }) as WhatsappResposta).filter(r => r.numeroId === numeroId).sort((a, b) => (a.atalho || a.texto).localeCompare(b.atalho || b.texto))));
    return () => u();
  }, [numeroId]);
  const inp = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
  const criar = async () => {
    const t = texto.trim(); if (!t) return;
    await addDoc(collection(db, "whatsappRespostas"), sanitizeForFirestore({ numeroId, atalho: atalho.trim().replace(/^\/+/, "") || null, texto: t, criadoEm: new Date().toISOString(), criadoPor: me?.id || null }));
    setAtalho(""); setTexto(""); setAddOpen(false);
  };
  const excluir = async (id: string) => { if (confirm("Excluir esta resposta rápida?")) await deleteDoc(doc(db, "whatsappRespostas", id)); };
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold text-gray-500 uppercase">⚡ Respostas rápidas ({itens.length})</div>
      <p className="text-[11px] text-gray-400">No chat, digite <b>/</b> pra escolher uma. O atalho ajuda a achar (ex.: <code>/horario</code>).</p>
      <div className="space-y-1.5">
        {itens.length === 0 && <div className="text-xs text-gray-400">Nenhuma ainda.</div>}
        {itens.map(r => (
          <div key={r.id} className="flex items-start gap-2 rounded-lg border border-gray-100 dark:border-gray-800 p-2">
            <div className="flex-1 min-w-0">
              {r.atalho && <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">/{r.atalho}</div>}
              <div className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words">{r.texto}</div>
            </div>
            <button type="button" onClick={() => void excluir(r.id)} className="text-gray-400 hover:text-rose-600 text-sm shrink-0">🗑️</button>
          </div>
        ))}
      </div>
      {addOpen ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 space-y-2">
          <input value={atalho} onChange={e => setAtalho(e.target.value)} className={inp} placeholder="Atalho (opcional) — ex.: horario" />
          <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={3} className={inp} placeholder="Texto da resposta…" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setAddOpen(false); setAtalho(""); setTexto(""); }} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Cancelar</button>
            <Button size="sm" onClick={() => void criar()} disabled={!texto.trim()}>Adicionar</Button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAddOpen(true)} className="w-full text-xs font-semibold px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50">➕ Nova resposta rápida</button>
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
function TransferModal({ pessoas, meId, modo = "transferir", onClose, onTransferir }: { pessoas: Pessoa[]; meId: string | null; modo?: "atribuir" | "transferir"; onClose: () => void; onTransferir: (p: Pessoa, nota: string) => Promise<void> }) {
  const [busca, setBusca] = useState("");
  const [nota, setNota] = useState("");
  const [sel, setSel] = useState<Pessoa | null>(null);
  const atribuir = modo === "atribuir";
  const verbo = atribuir ? "Atribuir" : "Transferir";
  const lista = useMemo(() => { const q = busca.trim().toLowerCase(); return [...pessoas].sort((a, b) => a.nome.localeCompare(b.nome)).filter(p => (atribuir || p.id !== meId) && (!q || p.nome.toLowerCase().includes(q))); }, [pessoas, busca, meId, atribuir]);
  return (
    <Modal onClose={onClose} title={`${atribuir ? "🙋" : "↪"} ${verbo} conversa`} maxWidth="max-w-md">
      <div className="space-y-3">
        <p className="text-[11px] text-gray-400">{atribuir ? "Escolha o atendente responsável por esta conversa." : "Quem você escolher assume a conversa."}</p>
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar atendente…" className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
        <div className="max-h-52 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {lista.length === 0 && <div className="px-3 py-3 text-sm text-gray-400">Nenhum atendente disponível pra este número.</div>}
          {lista.map(p => (
            <button key={p.id} type="button" onClick={() => setSel(p)} className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/40 ${sel?.id === p.id ? "bg-indigo-50 dark:bg-indigo-900/20" : ""}`}>
              {sel?.id === p.id ? "✓ " : ""}{p.nome}
            </button>
          ))}
        </div>
        <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2} placeholder={atribuir ? "Nota (opcional): contexto pro atendente…" : "Nota do repasse (opcional): contexto pro próximo atendente…"} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => sel && void onTransferir(sel, nota.trim())} disabled={!sel}>{verbo}{sel ? ` ${atribuir ? "a" : "para"} ${sel.nome.split(" ")[0]}` : ""}</Button>
        </div>
      </div>
    </Modal>
  );
}

function FiltroChip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`shrink-0 whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${ativo ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>{children}</button>
  );
}

// Cadastro das tags (aba Configuração do módulo). Self-contido.
export function TagsManager() {
  const [tags, setTags] = useState<WhatsappTag[]>([]);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [cor, setCor] = useState(PALETA[0]!);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const u = onSnapshot(collection(db, "whatsappTags"), snap => setTags(snap.docs.map(d => ({ id: d.id, ...d.data() }) as WhatsappTag).sort((a, b) => a.nome.localeCompare(b.nome))));
    return () => u();
  }, []);
  const criar = async () => { const n = nome.trim(); if (!n) return; await addDoc(collection(db, "whatsappTags"), sanitizeForFirestore({ nome: n, cor, descricao: descricao.trim() || null, criadoEm: new Date().toISOString() })); setNome(""); setDescricao(""); setOpen(false); };
  const excluir = async (id: string) => { if (confirm("Excluir esta tag?")) await deleteDoc(doc(db, "whatsappTags", id)); };
  const inp = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        {tags.length === 0 && <span className="text-sm text-gray-400">Nenhuma tag ainda.</span>}
        {tags.map(t => (
          <span key={t.id} className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-full text-white" style={{ background: t.cor || "#6366f1" }} title={t.descricao || undefined}>
            {t.nome}
            <button type="button" onClick={() => void excluir(t.id)} className="opacity-80 hover:opacity-100 leading-none">×</button>
          </span>
        ))}
      </div>
      <Button className="w-full" size="sm" onClick={() => { setNome(""); setDescricao(""); setCor(PALETA[0]!); setOpen(true); }}>➕ Adicionar nova tag</Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">🏷 Nova tag</h3>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase">Nome da tag *</label>
              <input value={nome} onChange={e => setNome(e.target.value)} className={inp} placeholder="Ex.: Aguardando pagamento" autoFocus
                onKeyDown={e => { if (e.key === "Enter" && nome.trim()) void criar(); }} />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase">Descrição (opcional)</label>
              <input value={descricao} onChange={e => setDescricao(e.target.value)} className={inp} placeholder="Pra que serve esta etiqueta" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase">Cor</label>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {PALETA.map(c => (
                  <button key={c} type="button" onClick={() => setCor(c)} className={`w-7 h-7 rounded-full ${cor === c ? "ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-900" : ""}`} style={{ background: c }} />
                ))}
              </div>
            </div>
            {/* Prévia */}
            <div className="flex items-center gap-2 text-xs text-gray-500">Prévia:
              <span className="inline-flex items-center text-sm px-2.5 py-1 rounded-full text-white" style={{ background: cor }}>{nome.trim() || "Tag"}</span>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setOpen(false)} className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Cancelar</button>
              <Button onClick={() => void criar()} disabled={!nome.trim()}>Adicionar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
