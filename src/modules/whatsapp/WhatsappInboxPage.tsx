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
import { useParams, useSearchParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, deleteField, doc, limit, onSnapshot, orderBy, query, setDoc, updateDoc, where, writeBatch, type Query, type QuerySnapshot, type DocumentData } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { authHeader } from "../../core/firebase/idToken";
import { Button } from "../../core/ui/Button";
import { Modal } from "../../core/ui/Modal";
import { WhatsappTemplatesTab } from "./WhatsappTemplatesTab";
import { AssistenteIaNumero } from "./AssistenteIaNumero";
import type { Pessoa, WhatsappTag, WhatsappContato, WhatsappNumero, WhatsappResposta, WhatsappRoteamento, Cliente } from "../../core/types";
import { PAPEIS_WHATSAPP, type PapelWhatsapp, type WhatsappRoteio } from "../../core/whatsapp/roteios";

type Msg = { id: string; waId: string; nome?: string | null; direcao: "in" | "out"; tipo?: string; texto?: string; timestamp?: string; recebidoEm?: string; lido?: boolean; autorNome?: string | null; numeroId?: string; sistema?: boolean; midia?: string; midiaUrl?: string; midiaNome?: string; mime?: string; messageId?: string; reacao?: string | null; editado?: boolean; apagada?: boolean; apagadaParaCliente?: boolean; ehGrupo?: boolean; autor?: string | null; autorJid?: string | null; viaAparelho?: boolean; status?: number; falhou?: boolean; incerto?: boolean; origTimestamp?: string; quotedId?: string | null; quotedTexto?: string | null; quotedAutor?: string | null };

const hhmm = (iso?: string) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
const fmtBRcurto = (ymd?: string | null) => { if (!ymd) return ""; const [a, m, d] = String(ymd).split("-"); return d ? `${d}/${m}/${a?.slice(2) || ""}` : String(ymd); };
const soDig = (s?: string | null) => (s || "").replace(/\D/g, "");
// DDIs internacionais comuns — pra detectar/formatar número estrangeiro (casa o
// mais específico primeiro: 3 díg → 2 → 1). NÃO inclui 55 (BR tem tratamento próprio).
const DDI_SET = new Set(["1","7","20","27","30","31","32","33","34","36","39","40","41","43","44","45","46","47","48","49","51","52","53","54","56","57","58","60","61","62","63","64","65","66","81","82","84","86","90","91","92","93","94","95","98","212","213","216","218","220","221","233","234","240","244","249","250","251","254","255","256","258","260","263","264","265","267","268","291","297","298","299","350","351","352","353","354","355","356","357","358","359","370","371","372","373","374","375","376","377","378","380","381","382","383","385","386","387","389","420","421","423","500","501","502","503","504","505","506","507","509","590","591","592","593","594","595","596","597","598","599","670","672","673","674","675","676","677","678","679","680","685","687","689","852","853","855","856","880","886","960","961","962","963","964","965","966","967","968","970","971","972","973","974","975","976","977","992","993","994","995","996","998"]);
const achaDDI = (d: string): string => { for (const k of [3, 2, 1]) { const p = d.slice(0, k); if (DDI_SET.has(p)) return p; } return ""; };
// Telefone BR válido (sem DDI): DDD(2)+8 (fixo) ou DDD(2)+9XXXXXXXX (celular).
const ehBRValido = (semDDI: string): boolean => semDDI.length === 10 || (semDDI.length === 11 && semDDI[2] === "9");
const foneBonito = (wa: string) => {
  const d = soDig(wa);
  if (!d) return wa;
  const semDDI = (d.length === 12 || d.length === 13) && d.startsWith("55") ? d.slice(2) : d;
  // BR: com DDI 55 (12/13 díg) OU local puro (10/11 díg), desde que o padrão bata.
  if (ehBRValido(semDDI) && (d === semDDI || d.startsWith("55"))) {
    return `+55 ${semDDI.slice(0, 2)} ${semDDI.slice(2, semDDI.length - 4)}-${semDDI.slice(-4)}`;
  }
  // Internacional: 8–14 díg começando por DDI conhecido (não-55) → "+DDI ddd ddd…".
  if (d.length >= 8 && d.length <= 14 && !d.startsWith("55")) {
    const ddi = achaDDI(d);
    if (ddi) return `+${ddi} ${d.slice(ddi.length).replace(/(\d{3})(?=\d)/g, "$1 ").trim()}`;
  }
  // Sem padrão discável (ex.: LID do WhatsApp, número gigante de privacidade) →
  // rótulo neutro em vez de um "+55 …" falso e malformado.
  return `Contato ···${d.slice(-4)}`;
};
// Chave de comparação que ignora DDI 55 e o 9º dígito de celular (DDD + 8 últimos).
function foneKey(raw?: string | null): string {
  const s = (raw || "").trim();
  if (s.startsWith("g:")) return s;   // grupo — chave virtual, não normaliza como telefone
  let d = soDig(raw);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : d;
}
const ehGrupoWaId = (waId?: string | null): boolean => (waId || "").startsWith("g:");
// Número digitado à mão → dígitos E.164 (sem +). Com "+" na frente = DDI explícito
// (usa verbatim). Sem "+": 10/11 díg = BR local → prefixa 55; senão já tem DDI.
const digitosEnviaveis = (raw: string): string => {
  const tevePlus = (raw || "").trim().startsWith("+");
  let d = soDig(raw);
  if (!d) return "";
  if (!tevePlus && d.length <= 11) d = "55" + d;
  return d;
};
const MSG_CLIENTE_ENCAMINHO = "Obrigado! Estou encaminhando seu atendimento para o setor responsável, que em breve entra em contato com você. Qualquer coisa só chamar de novo aqui! 🙏";

// Texto a exibir de uma mensagem. Reação criptografada (encReactionMessage) vem
// sem texto → mostra "reagiu a uma mensagem" em vez do código cru.
const textoMostra = (m: { texto?: string | null; tipo?: string | null }): string => {
  if (m.texto) return m.texto;
  if (m.tipo === "encReactionMessage" || m.tipo === "reactionMessage") return "reagiu a uma mensagem";
  return `[${m.tipo || "msg"}]`;
};

// É um telefone discável de verdade (BR ou internacional conhecido)? Se não, é
// um LID/número de privacidade do WhatsApp (não dá pra saber o número real).
const ehTelefoneBR = (wa: string) => {
  const d = soDig(wa);
  const semDDI = (d.length === 12 || d.length === 13) && d.startsWith("55") ? d.slice(2) : d;
  if (ehBRValido(semDDI)) return true;
  return d.length >= 8 && d.length <= 14 && !d.startsWith("55") && !!achaDDI(d);
};

// Selo informativo: um "i" que, ao tocar, abre uma explicação curta (linguagem do
// usuário) sobre por que algo aparece "diferente" do WhatsApp normal.
function InfoBadge({ texto }: { texto: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex align-middle">
      <button type="button" aria-label="Entenda" onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        className="w-3.5 h-3.5 inline-flex items-center justify-center rounded-full bg-gray-300 dark:bg-gray-600 text-white text-[9px] font-bold leading-none">i</button>
      {open && (
        <>
          <button type="button" aria-hidden className="fixed inset-0 z-40 cursor-default" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <span className="absolute z-50 top-5 left-1/2 -translate-x-1/2 w-52 p-2.5 rounded-lg bg-gray-900 dark:bg-gray-700 text-gray-50 text-[11px] font-normal normal-case tracking-normal leading-snug shadow-xl text-left whitespace-normal">{texto}</span>
        </>
      )}
    </span>
  );
}

// "Tempo sem resposta" de uma conversa aguardando o atendente. Cor por urgência:
// verde < 15 min, amarelo < 1 h, vermelho depois.
function tempoEsperaLabel(ms: number): { txt: string; cor: string } {
  const min = Math.floor(ms / 60000);
  const cor = min >= 60 ? "text-rose-600 dark:text-rose-400" : min >= 15 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400";
  if (min < 1) return { txt: "agora", cor: "text-emerald-600 dark:text-emerald-400" };
  if (min < 60) return { txt: `${min} min`, cor };
  const h = Math.floor(min / 60), rm = min % 60;
  if (h < 24) return { txt: rm ? `${h}h${String(rm).padStart(2, "0")}` : `${h}h`, cor };
  return { txt: `${Math.floor(h / 24)}d`, cor };
}

// Assina uma query com retry. Se o attach falha (ex.: permission-denied porque o
// token de auth ainda não propagou ao abrir o módulo), re-tenta com backoff em
// vez de morrer calada — senão a lista de números/conversas fica vazia até um
// reload manual.
function assinarComRetry(q: Query<DocumentData>, onData: (s: QuerySnapshot<DocumentData>) => void, incluirMetadata = false): () => void {
  let unsub = () => {};
  let cancelado = false;
  let tentativa = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const attach = () => {
    if (cancelado) return;
    // includeMetadataChanges: entrega também a transição cache→servidor
    // (fromCache: false) mesmo sem mudança de dado — é o que confirma "ao vivo".
    unsub = onSnapshot(q, { includeMetadataChanges: incluirMetadata }, (s) => { tentativa = 0; onData(s); }, () => {
      unsub();
      if (cancelado) return;
      timer = setTimeout(attach, Math.min(800 * 2 ** tentativa++, 6000));
    });
  };
  attach();
  return () => { cancelado = true; if (timer) clearTimeout(timer); unsub(); };
}

const PALETA = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#ef4444", "#0ea5e9", "#8b5cf6", "#64748b"];
const EMOJIS = ["😀","😁","😂","🤣","😊","😍","😘","😉","😎","🤗","🤔","😅","🙃","😴","😮","😢","😭","😡","👍","👎","👏","🙏","💪","🤝","👌","✌️","🔥","✨","🎉","❤️","🧡","💛","💚","💙","💜","🖤","💯","✅","❌","⚠️","⭐","📌","📎","📄","📷","🎁","💰","💳","🛵","🍔","🍕","🍟","🥤","☕","🍺","🎂","😋","🤤","👋","🫶","😇","🥳","🤩"];

export function WhatsappInboxPage({ modo = "completo", voltarListaSignal }: { modo?: "conversas" | "completo"; voltarListaSignal?: number } = {}) {
  const embutido = modo === "conversas";
  const { pessoa: me, fbUser } = useAuth();
  const authPronta = !!fbUser;   // token do Firebase disponível → listeners podem atacar
  const { rid } = useParams<{ rid: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { restaurants } = useRestaurant();
  const isMaster = !!me?.isMaster;
  const { can } = useCanAcao(rid || "");
  const podeVer = isMaster || can("whatsapp", "ver");
  const podeResponder = isMaster || can("whatsapp", "responder");
  const podeVincular = isMaster || can("whatsapp", "vincular");

  const [numeros, setNumeros] = useState<WhatsappNumero[]>([]);
  const [numeroSel, setNumeroSel] = useState<string | null>(null);
  const [novaConversa, setNovaConversa] = useState(false);
  const [novoGrupo, setNovoGrupo] = useState(false);
  const [qrRecon, setQrRecon] = useState<{ instancia: string; nome: string } | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [sincronizando, setSincronizando] = useState(true);   // true enquanto os dados vêm do cache (ainda buscando o servidor)
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [contatos, setContatos] = useState<Record<string, WhatsappContato>>({});
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [tags, setTags] = useState<WhatsappTag[]>([]);
  const [respostas, setRespostas] = useState<WhatsappResposta[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [editarNum, setEditarNum] = useState(false);   // modal "editar contato" (nome/número)
  const [resposta, setResposta] = useState("");
  // Rascunho por conversa: o texto digitado fica preso à conversa em que foi
  // escrito. Ao trocar de conversa, salva o rascunho da anterior e carrega o da
  // nova (vazio se não houver). rascunhosRef guarda os textos por chave de fone.
  const rascunhosRef = useRef<Record<string, string>>({});
  const respostaRef = useRef("");
  respostaRef.current = resposta;
  const selPrevRef = useRef<string | null>(null);
  const [mencionados, setMencionados] = useState<{ numero: string; jid: string }[]>([]);  // @-marcados (grupo)
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);   // trava síncrona contra duplo-envio (state é async)
  const [acaoMsgId, setAcaoMsgId] = useState<string | null>(null);   // popover de ações aberto (id da msg)
  const [editMsg, setEditMsg] = useState<{ id: string; texto: string } | null>(null);   // edição inline
  const [respondendo, setRespondendo] = useState<Msg | null>(null);   // mensagem sendo citada (reply)
  useEffect(() => { setRespondendo(null); }, [sel]);   // troca de conversa cancela a citação em andamento
  const [emojiAberto, setEmojiAberto] = useState(false);
  const [filtroTag, setFiltroTag] = useState<string | null>(null);
  const [busca, setBusca] = useState("");   // busca por contato/número/conteúdo nas conversas do número aberto
  useEffect(() => { setBusca(""); }, [numeroSel]);   // troca de número zera a busca
  // Atribuição: inicio (Sem resp.|Minhas) · outras (De outros|Finalizadas) · spam.
  // Livre: conversas (lista única) · finalizados · spam. abaAtual normaliza por modo.
  const [filtroAtrib, setFiltroAtrib] = useState<"inicio" | "outras" | "spam" | "conversas" | "finalizados">("inicio");
  const [agora, setAgora] = useState(() => Date.now());   // relógio p/ o contador "tempo sem resposta"
  // Notificação no PC (navegador) de mensagem nova de WhatsApp.
  const [notifPerm, setNotifPerm] = useState<string>(() => (typeof Notification !== "undefined" ? Notification.permission : "denied"));
  const notifVistosRef = useRef<Set<string>>(new Set());   // ids de msg já vistos (não re-notifica)
  const notifProntoRef = useRef(false);                    // 1ª carga não notifica (marca tudo como visto)
  const notifDesdeRef = useRef(new Date().toISOString());  // só notifica msg mais nova que a abertura
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
  // Troca de conversa: salva o rascunho da anterior e carrega o da nova. Roda
  // antes de qualquer leitura do compositor porque `resposta` ainda contém o
  // texto da conversa anterior neste ponto (só é trocado aqui).
  useEffect(() => {
    const cur = sel ? foneKey(sel) : null;
    const prev = selPrevRef.current;
    if (cur === prev) return;
    if (prev) rascunhosRef.current[prev] = respostaRef.current;
    selPrevRef.current = cur;
    setResposta(cur ? (rascunhosRef.current[cur] ?? "") : "");
  }, [sel]);
  // Auto-expande o campo de resposta conforme o texto (até ~5 linhas → rola).
  useEffect(() => {
    const el = taRef.current; if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 132) + "px";
  }, [resposta, sel]);
  // Relógio do contador "tempo sem resposta" — atualiza a cada 30 s.
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 30_000); return () => clearInterval(t); }, []);
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
  // Todos os listeners só atacam quando a auth do Firebase está pronta (token
  // disponível). Sem isso, ao abrir o módulo antes do token propagar, o Firestore
  // devolve permission-denied e o listener morre → tela vazia até reload manual.
  useEffect(() => {
    if (!authPronta) return;
    // Só as mensagens RECENTES (últimos 90 dias, cap 4000) — antes puxava a
    // coleção INTEIRA a cada abertura, o que deixava o inbox lento. Isso cobre as
    // conversas ativas; abrir uma conversa muito antiga mostra até esse limite.
    const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    let offTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = assinarComRetry(query(collection(db, "whatsappMensagens"), where("timestamp", ">=", cutoff), orderBy("timestamp", "desc"), limit(4000)), snap => {
      setMsgs(snap.docs.slice().reverse().map(d => ({ id: d.id, ...d.data() }) as Msg));   // reverse → ordem crescente
      // Status AO VIVO: fromCache=false = veio do servidor agora (conectado).
      // Se cair pro cache, só marca "conectando" se ficar assim >2s (evita
      // piscar a cada envio/mensagem, que passa rápido pelo cache local).
      if (!snap.metadata.fromCache) {
        if (offTimer) { clearTimeout(offTimer); offTimer = null; }
        setSincronizando(false);
      } else if (!offTimer) {
        offTimer = setTimeout(() => { setSincronizando(true); offTimer = null; }, 2000);
      }
    }, true);   // includeMetadataChanges: pra receber a confirmação do servidor
    return () => { if (offTimer) clearTimeout(offTimer); unsub(); };
  }, [authPronta]);

  useEffect(() => {
    if (!authPronta) return;
    return assinarComRetry(collection(db, "whatsappNumeros"), snap =>
      setNumeros(snap.docs.map(d => ({ id: d.id, ...d.data() }) as WhatsappNumero).filter(n => n.ativo !== false)));
  }, [authPronta]);

  useEffect(() => {
    if (!authPronta) return;
    const base = collection(db, "pessoas");
    const rids = ridsKey ? ridsKey.split(",").slice(0, 10) : [];
    const q = isMaster ? base : (rids.length ? query(base, where("restaurantIds", "array-contains-any", rids)) : null);
    if (!q) { setPessoas([]); return; }
    return assinarComRetry(q, snap => setPessoas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa)));
  }, [authPronta, isMaster, ridsKey]);

  useEffect(() => {
    if (!authPronta) return;
    return assinarComRetry(collection(db, "whatsappContatos"), snap => {
      const m: Record<string, WhatsappContato> = {};
      // Indexa pela chave normalizada (DDD + 8 últimos), pra casar as duas formas
      // do número (com/sem o 9º dígito) no mesmo contato.
      snap.docs.forEach(d => { const data = { id: d.id, ...d.data() } as WhatsappContato; const k = foneKey(d.id); if (!m[k] || (data.atualizadoEm || "") > (m[k].atualizadoEm || "")) m[k] = data; });
      setContatos(m);
    });
  }, [authPronta]);

  // Clientes do Reservas+CRM (das empresas do usuário) — pra casar por telefone.
  useEffect(() => {
    if (!authPronta) return;
    const rids = ridsKey ? ridsKey.split(",").slice(0, 10) : [];
    if (!rids.length) { setClientes([]); return; }
    return assinarComRetry(query(collection(db, "clientes"), where("restaurantId", "in", rids)),
      snap => setClientes(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cliente)));
  }, [authPronta, ridsKey]);

  useEffect(() => {
    if (!authPronta) return;
    return assinarComRetry(collection(db, "whatsappTags"), snap =>
      setTags(snap.docs.map(d => ({ id: d.id, ...d.data() }) as WhatsappTag).sort((a, b) => a.nome.localeCompare(b.nome))));
  }, [authPronta]);
  useEffect(() => {
    if (!authPronta) return;
    return assinarComRetry(collection(db, "whatsappRespostas"), snap =>
      setRespostas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as WhatsappResposta)));
  }, [authPronta]);

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

  // Deep-link "Falar pelo WhatsApp": ?numero=<id>&to=<fone>&nome=<>. Pré-seleciona
  // o número (se a pessoa tiver acesso — senão fica o padrão, dá pra trocar) e
  // abre a conversa com o telefone. Aplica uma vez e limpa os params da URL.
  const deepLinkRef = useRef(false);
  useEffect(() => {
    if (deepLinkRef.current) return;
    const pNum = searchParams.get("numero");
    const pTo = searchParams.get("to");
    if (!pNum && !pTo) return;
    if (numerosVisiveis.length === 0) return;   // aguarda os números carregarem
    deepLinkRef.current = true;
    if (pNum && numerosVisiveis.some(n => n.id === pNum)) setNumeroSel(pNum);
    if (pTo) {
      setSel(pTo);
      const pNome = searchParams.get("nome");
      if (pNome) { const ck = foneKey(pTo); if (!contatos[ck]?.nomeManual && !contatos[ck]?.nomePush) void salvarContato(pTo, { nomeManual: pNome }); }
      const pTexto = searchParams.get("texto");
      if (pTexto) {
        // Grava no rascunho da conversa alvo pra sobreviver ao efeito de troca
        // de conversa (que carrega o rascunho da chave ao mudar `sel`).
        rascunhosRef.current[foneKey(pTo)] = pTexto;
        setResposta(pTexto);   // pré-preenche o compositor (ex.: confirmação de reserva)
      }
    }
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, numerosVisiveis]);

  // Só as mensagens do número selecionado.
  const msgsDoNumero = useMemo(() => msgs.filter(m => m.numeroId === numeroSel), [msgs, numeroSel]);

  // ── Saúde da conexão do número selecionado: avisa quando cai (device desligado,
  // sessão expirada). Sem isso, o inbox parece "vivo" mas nada entra/sai. ──
  const [statusConexao, setStatusConexao] = useState<string>("unknown");
  useEffect(() => {
    if (!numeroSel) { setStatusConexao("unknown"); return; }
    let vivo = true;
    // Falha na checagem → "unknown" (não mantém o "open" antigo, senão o inbox
    // mostra vivo enquanto a conexão caiu).
    const checar = async () => { const r = await chamarInstancia("status", numeroSel).catch(() => null); if (vivo) setStatusConexao(r?.estado || "unknown"); };
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
      const c = m.get(k) || { waId: msg.waId, nome: undefined, ultima: msg, naoLidas: 0 };
      c.ultima = msg; c.waId = msg.waId;
      // Só mensagens RECEBIDAS carregam o pushName do contato. As de saída trazem
      // o nome do número (ex.: "Escritório Central"), que poluía o título quando a
      // última mensagem era nossa. msgsDoNumero está em ordem asc → fica o mais recente.
      if (msg.nome && msg.direcao === "in") c.nome = msg.nome;
      m.set(k, c);
    }
    for (const msg of msgsDoNumero) if (msg.direcao === "in" && !msg.lido) { const c = m.get(foneKey(msg.waId)); if (c) c.naoLidas++; }
    return [...m.values()].sort((a, b) => (b.ultima.timestamp || "").localeCompare(a.ultima.timestamp || ""));
  }, [msgsDoNumero]);

  const contatoDe = (waId: string) => contatos[foneKey(waId)];
  const nomeConversa = (waId: string, waNome?: string | null) => {
    const c = contatoDe(waId);
    if (ehGrupoWaId(waId) || c?.ehGrupo) return c?.nomeManual || c?.nomeGrupo || "Grupo";
    // Pessoa da equipe vinculada é a identidade autoritativa: tem prioridade sobre
    // o nomeManual (que pode ter sido semeado de um lead e ficar desatualizado).
    // waNome vem só de mensagem recebida (pushName do contato). NÃO usar nomePush
    // como fallback: registros antigos foram poluídos pelo eco fromMe (nome do
    // próprio número, ex.: "Escritório Central").
    return pessoaDaConversa(waId)?.nome || c?.nomeManual || waNome || foneBonito(waId);
  };

  // Responsável de uma conversa: individual = atribuidoA (1); grupo = atendentes (N).
  const donoDe = (waId: string): string | null => contatoDe(waId)?.atribuidoA || null;
  const temResponsavel = (waId: string): boolean => {
    const c = contatoDe(waId);
    return ehGrupoWaId(waId) ? !!(c?.atendentes && c.atendentes.length > 0) : !!c?.atribuidoA;
  };
  const souResponsavel = (waId: string): boolean => {
    const c = contatoDe(waId);
    return ehGrupoWaId(waId) ? (c?.atendentes || []).includes(me?.id || "") : c?.atribuidoA === me?.id;
  };
  // Finalizado é POR NÚMERO: estados[numeroSel] sobrepõe o legado global de topo.
  const finalizadaDe = (waId: string, numId: string | null = numeroSel): boolean => {
    const c = contatoDe(waId);
    const e = numId ? c?.estados?.[numId] : undefined;
    const f = e && e.finalizadoEm !== undefined ? e.finalizadoEm : c?.finalizadoEm;
    return !!f;
  };
  // Não-lida (flag manual) também é POR NÚMERO — senão o "auto-marcar lida" da
  // conversa de origem apagava o não-lido do destino (mesmo contato global).
  const naoLidaManualDe = (waId: string, numId: string | null = numeroSel): boolean => {
    const c = contatoDe(waId);
    const e = numId ? c?.estados?.[numId] : undefined;
    return !!(e && e.naoLidaManual !== undefined ? e.naoLidaManual : c?.naoLidaManual);
  };
  const spamDe = (waId: string): boolean => !!contatoDe(waId)?.spam;
  // Grupo já triado? (definiram atendentes OU marcaram spam) — senão pede ao abrir.
  const triadoDe = (waId: string): boolean => {
    if (!ehGrupoWaId(waId)) return true;
    const c = contatoDe(waId);
    return !!(c?.triadoEm || (c?.atendentes && c.atendentes.length > 0) || c?.spam);
  };
  // Respeita o filtro de tag também na tela Início.
  const passaTag = (waId: string) => !filtroTag || (contatos[foneKey(waId)]?.tagIds || []).includes(filtroTag);

  // ── Busca por conversa/contato (número aberto) ────────────────────────────
  // Casa por nome do contato, número (só dígitos) OU conteúdo de qualquer
  // mensagem da conversa. O índice de texto só é montado quando há termo.
  const buscaNorm = busca.trim().toLowerCase();
  const buscaDigitos = buscaNorm.replace(/\D/g, "");
  const textoPorConversa = useMemo(() => {
    if (!buscaNorm) return null;
    const m = new Map<string, string>();
    for (const msg of msgsDoNumero) {
      if (!msg.texto) continue;
      const k = foneKey(msg.waId);
      m.set(k, (m.get(k) || "") + " " + msg.texto.toLowerCase());
    }
    return m;
  }, [msgsDoNumero, buscaNorm]);
  const passaBusca = (waId: string) => {
    if (!buscaNorm) return true;
    if (nomeConversa(waId).toLowerCase().includes(buscaNorm)) return true;
    if (buscaDigitos.length >= 3 && waId.replace(/\D/g, "").includes(buscaDigitos)) return true;
    const txt = textoPorConversa?.get(foneKey(waId));
    return !!txt && txt.includes(buscaNorm);
  };

  // Coluna direita do Início: "Minhas" — todas as minhas ativas, sempre por
  // mensagem mais recente (herda a ordem de `conversas`).
  const minhas = useMemo(() => conversas
    .filter(c => passaTag(c.waId) && passaBusca(c.waId) &&souResponsavel(c.waId) && !finalizadaDe(c.waId) && !spamDe(c.waId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversas, contatos, me?.id, filtroTag, busca]);
  // Coluna esquerda do Início: "Sem responsável ainda" — ninguém assumiu (recente primeiro).
  const semRespAinda = useMemo(() => conversas
    .filter(c => passaTag(c.waId) && passaBusca(c.waId) &&!temResponsavel(c.waId) && !finalizadaDe(c.waId) && !spamDe(c.waId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversas, contatos, filtroTag, busca]);

  // Modo do número selecionado. "livre" = sem dono, lista única lido/não lido.
  const numeroLivre = numeros.find(n => n.id === numeroSel)?.modo === "livre";

  // Coluna esquerda de "Outras": conversas atribuídas a OUTRA pessoa (não a mim).
  const deOutros = useMemo(() => conversas
    .filter(c => passaTag(c.waId) && passaBusca(c.waId) &&temResponsavel(c.waId) && !souResponsavel(c.waId) && !finalizadaDe(c.waId) && !spamDe(c.waId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversas, contatos, me?.id, filtroTag, busca]);
  const finalizadasList = useMemo(() => conversas
    .filter(c => passaTag(c.waId) && passaBusca(c.waId) &&finalizadaDe(c.waId) && !spamDe(c.waId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversas, contatos, filtroTag, busca]);
  const spamList = useMemo(() => conversas
    .filter(c => passaTag(c.waId) && passaBusca(c.waId) &&spamDe(c.waId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversas, contatos, filtroTag, busca]);
  // Modo livre: lista única ativa, sempre por mensagem mais recente (herda a ordem
  // de `conversas`, que já vem do mais recente pro mais antigo).
  const conversasLivre = useMemo(() => conversas
    .filter(c => passaTag(c.waId) && passaBusca(c.waId) &&!finalizadaDe(c.waId) && !spamDe(c.waId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversas, contatos, filtroTag, busca]);

  // Contadores dos chips.
  const minhasAguardando = minhas.filter(c => c.naoLidas > 0 || c.ultima.direcao === "in").length;
  const contInicio = minhasAguardando + semRespAinda.length;
  const contOutras = deOutros.length + finalizadasList.length;
  const contFinalizadas = finalizadasList.length;
  const contSpam = spamList.length;
  const naoLidasLivre = conversasLivre.filter(c => c.naoLidas > 0 || naoLidaManualDe(c.waId)).length;

  // Aba efetiva por modo (normaliza um filtro que não existe no modo atual).
  const abaAtual = numeroLivre
    ? (filtroAtrib === "finalizados" || filtroAtrib === "spam" ? filtroAtrib : "conversas")
    : (filtroAtrib === "outras" || filtroAtrib === "spam" ? filtroAtrib : "inicio");

  // Tem não-lida numa lista? (pra sombrear o chip de vermelho).
  const temNaoLida = (lista: { waId: string; naoLidas: number }[]) =>
    lista.some(c => c.naoLidas > 0 || naoLidaManualDe(c.waId));

  // Notificação no PC: dispara pra cada mensagem RECEBIDA nova nos números que a
  // pessoa acessa. 1ª carga (e histórico) não notifica.
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    const primeira = !notifProntoRef.current;
    notifProntoRef.current = true;
    const acessiveis = new Set(numerosVisiveis.map(n => n.id));
    for (const m of msgs) {
      if (notifVistosRef.current.has(m.id)) continue;
      notifVistosRef.current.add(m.id);
      if (primeira || notifPerm !== "granted") continue;
      if (m.direcao !== "in" || m.sistema) continue;
      if (m.numeroId && !acessiveis.has(m.numeroId)) continue;
      if (m.timestamp && m.timestamp < notifDesdeRef.current) continue;   // histórico
      if (!document.hidden && sel && foneKey(m.waId) === foneKey(sel) && m.numeroId === numeroSel) continue;
      try {
        const n = new Notification((m.ehGrupo ? "👥 " : "💬 ") + nomeConversa(m.waId, m.nome), { body: textoMostra(m), tag: (m.numeroId || "") + "|" + foneKey(m.waId) });
        n.onclick = () => { window.focus(); if (m.numeroId) setNumeroSel(m.numeroId); setSel(m.waId); n.close(); };
      } catch { /* navegador bloqueou */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, notifPerm, numerosVisiveis, sel, numeroSel]);

  const thread = useMemo(() => {
    const base = msgsDoNumero.filter(x => foneKey(x.waId) === foneKey(sel || ""));
    // Dedup do envio "incerto" (timeout): se depois chegou o eco/ACK confirmado
    // (mesma saída, mesmo texto, ~5min), esconde a bolha ⏳ pra não duplicar.
    if (!base.some(m => m.incerto)) return base;
    const confirmadas = base.filter(m => m.direcao === "out" && !m.incerto);
    return base.filter(m => {
      if (!m.incerto) return true;
      const t = Date.parse(m.timestamp || "") || 0;
      return !confirmadas.some(c => (c.texto || "") === (m.texto || "") && Math.abs((Date.parse(c.timestamp || "") || 0) - t) < 5 * 60_000);
    });
  }, [msgsDoNumero, sel]);
  // Rola pro fim ao abrir a conversa ou chegar mensagem nova.
  useEffect(() => { const t = setTimeout(() => msgsEndRef.current?.scrollIntoView({ block: "end" }), 50); return () => clearTimeout(t); }, [sel, thread.length]);
  const nomeSel = sel ? nomeConversa(sel, conversas.find(c => foneKey(c.waId) === foneKey(sel))?.nome) : "";

  // Marca recebidas como lidas ao abrir + limpa a flag manual de não-lida.
  useEffect(() => {
    if (!sel) return;
    for (const m of msgs) if (foneKey(m.waId) === foneKey(sel) && m.direcao === "in" && !m.lido) void updateDoc(doc(db, "whatsappMensagens", m.id), { lido: true }).catch(() => {});
    if (naoLidaManualDe(sel)) void salvarContato(sel, { naoLidaManual: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, msgs]);

  // ── Writers ──────────────────────────────────────────────────────────────
  // Campos cujo estado é POR NÚMERO (não global). Vão pra estados[numeroId] e o
  // campo de topo legado é limpo, pra não vazar entre caixas.
  const CAMPOS_POR_NUMERO = new Set(["finalizadoEm", "finalizadoPor", "naoLidaManual"]);
  async function salvarContato(waId: string, patch: Partial<WhatsappContato>, numeroIdAlvo: string | null = numeroSel) {
    // Doc keyed pela chave normalizada (DDD + 8 últimos) → tags/vínculos casam
    // com/sem o 9º dígito. Guarda o waId cru pra referência.
    const k = foneKey(waId);
    const write: Record<string, unknown> = { id: k, waId, atualizadoEm: new Date().toISOString(), atualizadoPor: me?.id || null };
    const estado: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(patch)) {
      if (CAMPOS_POR_NUMERO.has(key) && numeroIdAlvo) { estado[key] = val; write[key] = deleteField(); }
      else write[key] = val;
    }
    if (numeroIdAlvo && Object.keys(estado).length) write.estados = { [numeroIdAlvo]: estado };
    await setDoc(doc(db, "whatsappContatos", k), sanitizeForFirestore(write), { merge: true });
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
    if (enviandoRef.current) return;   // já tem um envio em andamento → ignora (anti-duplicata)
    enviandoRef.current = true;
    setEnviando(true);
    try {
      // Grupo não reatribui ao responder (já tem atendentes). Individual: assume.
      const grupoSel = ehGrupoWaId(sel);
      if (!numeroLivre && !grupoSel && !(await assumirConversa(sel))) return;   // livre = quem vê responde, sem assumir
      // Grupo → envia pro JID do grupo (<id>@g.us). Individual → o número que o
      // cliente REALMENTE usou por último (com/sem o 9º dígito).
      const inbound = thread.filter(m => m.direcao === "in");
      const paraEnviar = grupoSel ? `${sel.slice(2)}@g.us` : (inbound.length ? inbound[inbound.length - 1].waId : sel);
      // Prefixo enviado AO CLIENTE usa o apelido cadastrado neste número (se houver);
      // internamente (doc) gravamos sempre o nome real.
      const autorCliente = (numeros.find(n => n.id === numeroSel)?.apelidos?.[me?.id || ""] || "").trim() || me?.nome || "";
      // @-marcações (só grupo): JIDs cujos @número ainda estão no texto.
      const mentioned = grupoSel ? mencionados.filter(mn => txt.includes(`@${mn.numero}`)).map(mn => mn.jid) : [];
      // Citação (responder): monta o `quoted` pra Evolution (precisa do messageId
      // da citada) + os campos que ficam no doc pra render local.
      const cit = respondendo;
      const citAutor = cit ? (cit.direcao === "out" ? (cit.autorNome || "Você") : (cit.autorNome || nomeSel || "Cliente")) : null;
      const citTexto = cit ? (cit.texto || textoMostra(cit)) : null;
      const quoted = cit?.messageId ? {
        key: { id: cit.messageId, remoteJid: grupoSel ? `${sel.slice(2)}@g.us` : `${paraEnviar}@s.whatsapp.net`, fromMe: cit.direcao === "out", ...(cit.autorJid ? { participant: cit.autorJid } : {}) },
        message: { conversation: citTexto || "" },
      } : null;
      const r = await fetch("/api/evolution-enviar", {
        method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) },
        // Individual: manda o JID completo (<num>@s.whatsapp.net) — o waId já é
        // E.164 internacional; assim o backend não prefixa 55 num nº estrangeiro.
        // telefoneManual (número corrigido à mão) tem prioridade sobre o waId.
        body: JSON.stringify({ instancia: numeroSel, to: grupoSel ? paraEnviar : `${contatos[foneKey(sel)]?.telefoneManual || soDig(paraEnviar)}@s.whatsapp.net`, texto: txt, autorNome: autorCliente, ...(mentioned.length ? { mentioned } : {}), ...(quoted ? { quoted } : {}) }),
      });
      const j = await r.json().catch(() => ({}));
      // Base do doc (sem status): reusada no sucesso e no "incerto" (timeout).
      const baseDoc = (extra: Record<string, unknown>) => sanitizeForFirestore({ waId: sel, nome: nomeSel || null, direcao: "out", tipo: "text", texto: txt, timestamp: new Date().toISOString(), recebidoEm: new Date().toISOString(), lido: true, numeroId: numeroSel, autorNome: me?.nome || null, autorId: me?.id || null, ...(cit ? { quotedId: cit.messageId || cit.id, quotedTexto: (citTexto || "").slice(0, 300) || null, quotedAutor: citAutor } : {}), ...extra });
      if (r.ok && (j as { ok?: boolean }).ok) {
        // Grava com id determinístico ${numeroId}_${messageId} pra (1) permitir
        // editar/apagar depois e (2) casar com o eco fromMe do webhook (dedup).
        const mid = (j as { messageId?: string }).messageId || null;
        const docMsg = baseDoc({ status: 1, ...(mid ? { messageId: mid } : {}) });
        if (mid) await setDoc(doc(db, "whatsappMensagens", `${numeroSel}_${mid}`), docMsg, { merge: true });
        else await addDoc(collection(db, "whatsappMensagens"), docMsg);
        rascunhosRef.current[foneKey(sel)] = "";   // rascunho enviado → limpa
        setResposta(""); setMencionados([]); setRespondendo(null);
      } else if ((j as { naoConfigurado?: boolean; numeroInexistente?: boolean }).naoConfigurado || (j as { numeroInexistente?: boolean }).numeroInexistente) {
        // Falha DEFINITIVA (não configurado / número sem WhatsApp): não grava, avisa.
        alert((j as { naoConfigurado?: boolean }).naoConfigurado ? "Evolution ainda não configurada (env vars na Vercel)." : ((j as { error?: string }).error || "Este número não tem WhatsApp."));
      } else {
        // Timeout / Evolution instável: a mensagem PODE ter saído (Evolution lento
        // devolve erro mesmo entregando). Grava como INCERTA (⏳) pra não sumir — o
        // ACK/eco do webhook confirma depois (ou o operador reenvia se ficar ⏳).
        await addDoc(collection(db, "whatsappMensagens"), baseDoc({ status: 0, incerto: true }));
        rascunhosRef.current[foneKey(sel)] = "";
        setResposta(""); setMencionados([]); setRespondendo(null);
      }
    } catch (e) {
      // Rede caiu no meio: também grava incerta em vez de perder a mensagem.
      if (sel && numeroSel) await addDoc(collection(db, "whatsappMensagens"), sanitizeForFirestore({ waId: sel, nome: nomeSel || null, direcao: "out", tipo: "text", texto: txt, timestamp: new Date().toISOString(), recebidoEm: new Date().toISOString(), lido: true, numeroId: numeroSel, autorNome: me?.nome || null, autorId: me?.id || null, status: 0, incerto: true })).catch(() => alert("Falha ao enviar: " + (e instanceof Error ? e.message : "?")));
    }
    finally { setEnviando(false); enviandoRef.current = false; }
  }

  // ── Mídia: foto/vídeo/documento/áudio ──────────────────────────────────────
  async function enviarMidia(tipo: "image" | "video" | "document" | "audio", dataUrl: string, fileName: string, mimetype: string, caption = "") {
    if (!sel || !numeroSel) return;
    const grupoSel = ehGrupoWaId(sel);
    if (!grupoSel && !(await assumirConversa(sel))) return;
    const inbound = thread.filter(m => m.direcao === "in");
    const paraEnviar = grupoSel ? `${sel.slice(2)}@g.us` : (inbound.length ? inbound[inbound.length - 1].waId : sel);
    setEnviandoMidia(true);
    try {
      const autorCliente = (numeros.find(n => n.id === numeroSel)?.apelidos?.[me?.id || ""] || "").trim() || me?.nome || "";
      const r = await fetch("/api/evolution-enviar-midia", {
        method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ instancia: numeroSel, to: grupoSel ? paraEnviar : `${contatos[foneKey(sel)]?.telefoneManual || soDig(paraEnviar)}@s.whatsapp.net`, tipo, base64: dataUrl, mimetype, fileName, caption, autorNome: autorCliente }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && (j as { ok?: boolean }).ok) {
        const tipoMsg = tipo === "image" ? "imageMessage" : tipo === "video" ? "videoMessage" : tipo === "audio" ? "audioMessage" : "documentMessage";
        const rotulo = caption || (tipo === "image" ? "🖼️ Imagem" : tipo === "video" ? "🎬 Vídeo" : tipo === "audio" ? "🎤 Áudio" : `📄 ${fileName}`);
        const guardaMidia = dataUrl.length <= 900_000;   // ~675KB cabe no doc do Firestore
        const midMedia = (j as { messageId?: string }).messageId || null;
        const docMedia = sanitizeForFirestore({
          waId: sel, nome: nomeSel || null, direcao: "out", tipo: tipoMsg, texto: rotulo,
          timestamp: new Date().toISOString(), recebidoEm: new Date().toISOString(), lido: true,
          numeroId: numeroSel, autorNome: me?.nome || null, autorId: me?.id || null, status: 1,
          ...(midMedia ? { messageId: midMedia } : {}),
          ...(tipo === "document" ? { midiaNome: fileName } : {}),
          ...(guardaMidia ? { midia: dataUrl, mime: mimetype } : {}),
        });
        if (midMedia) await setDoc(doc(db, "whatsappMensagens", `${numeroSel}_${midMedia}`), docMedia, { merge: true });
        else await addDoc(collection(db, "whatsappMensagens"), docMedia);
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

  // ── @ marcar em grupo ──────────────────────────────────────────────────
  // Participantes do grupo: números do contato (findGroupInfos) + nomes que
  // vieram dos autores do thread. Base do picker de "@".
  const grupoSelKey = ehGrupoWaId(sel || "");
  // Candidatos pra "@": SÓ quem já falou no grupo (tem nome + JID confiável).
  // Os "participantes" do findGroupInfos vêm em formato LID (número gigante, sem
  // nome) — inúteis pra marcar; ignorados de propósito.
  const participantesGrupo = useMemo(() => {
    if (!grupoSelKey) return [] as { numero: string; nome: string; jid: string }[];
    const porJid = new Map<string, { numero: string; nome: string; jid: string }>();
    for (const m of thread) {
      if (!m.ehGrupo || m.direcao !== "in" || !m.autorNome) continue;
      const jid = m.autorJid || (m.autor ? `${m.autor}@s.whatsapp.net` : "");
      if (!jid) continue;
      const numero = soDig(jid.split("@")[0]);
      porJid.set(jid, { numero, nome: m.autorNome, jid });
    }
    return Array.from(porJid.values()).sort((a, b) => a.nome.localeCompare(b.nome));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupoSelKey, sel, thread]);
  // Token "@..." sendo digitado no fim do texto (só em grupo).
  const menMatch = grupoSelKey ? resposta.match(/(^|\s)@([^\s@]*)$/) : null;
  const menQ = menMatch ? menMatch[2].toLowerCase() : "";
  const menCandidatos = menMatch ? participantesGrupo.filter((p) => !menQ || p.nome.toLowerCase().includes(menQ) || p.numero.includes(menQ)).slice(0, 8) : [];
  function inserirMencao(p: { numero: string; nome: string; jid: string }) {
    // Texto tem @<número> (o WhatsApp resolve pro nome do lado de quem lê) + o
    // JID vai no "mentioned" pra a marcação de fato acontecer.
    setResposta((r) => r.replace(/(^|\s)@([^\s@]*)$/, (_m, pre) => `${pre}@${p.numero} `));
    setMencionados((prev) => prev.some(x => x.jid === p.jid) ? prev : [...prev, { numero: p.numero, jid: p.jid }]);
    taRef.current?.focus();
  }
  useEffect(() => { setMencionados([]); }, [sel]);

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
  // "Passar contexto pra alguém externo": resumo (IA) + recado + anexar recebidas.
  const [passarCtx, setPassarCtx] = useState(false);
  const [pcResumo, setPcResumo] = useState("");
  const [pcCarregando, setPcCarregando] = useState(false);
  const [pcRecado, setPcRecado] = useState("");
  const [pcAnexar, setPcAnexar] = useState(false);
  const [pcBusca, setPcBusca] = useState("");
  const [pcDest, setPcDest] = useState<{ nome?: string; telefone: string } | null>(null);
  const [pcEnviando, setPcEnviando] = useState(false);
  const [pcAvisar, setPcAvisar] = useState(false);       // externo: avisar cliente (padrão off)
  const [pcFinalizar, setPcFinalizar] = useState(false); // externo: finalizar original (padrão off)
  const [pcMsgCliente, setPcMsgCliente] = useState(MSG_CLIENTE_ENCAMINHO);
  // "Encaminhar para outro número (interno)": entrega a conversa pra outra equipe.
  const [encaminhar, setEncaminhar] = useState(false);
  const [encResumo, setEncResumo] = useState("");
  const [encCarregando, setEncCarregando] = useState(false);
  const [encObs, setEncObs] = useState("");
  const [encAlvo, setEncAlvo] = useState<string | null>(null);
  const [encAtendente, setEncAtendente] = useState<string | null>(null);   // atribuir direto (opcional)
  const [encEnviando, setEncEnviando] = useState(false);
  const [encAvisar, setEncAvisar] = useState(true);        // interno: avisar cliente (padrão on)
  const [encFinalizar, setEncFinalizar] = useState(true);  // interno: finalizar original (padrão on)
  const [encMsgCliente, setEncMsgCliente] = useState(MSG_CLIENTE_ENCAMINHO);
  const [encDesdeId, setEncDesdeId] = useState<string | null>(null); // 1ª msg do histórico a encaminhar (dela p/ frente)
  const [encIncluirResumo, setEncIncluirResumo] = useState(true);    // anexar resumo IA no topo
  // Triagem de grupo: define atendente(s) ou marca spam (some).
  const [triagemGrupo, setTriagemGrupo] = useState<string | null>(null);
  const [triagemIds, setTriagemIds] = useState<string[]>([]);
  const abrirTriagem = (waId: string) => { setTriagemIds(contatos[foneKey(waId)]?.atendentes || []); setTriagemGrupo(waId); };
  async function salvarTriagem(waId: string) {
    if (!triagemIds.length) { alert("Escolha pelo menos um atendente — ou marque como spam."); return; }
    const nomes = triagemIds.map(id => pessoas.find(p => p.id === id)?.nome || "").filter(Boolean);
    await salvarContato(waId, { atendentes: triagemIds, atendentesNomes: nomes, triadoEm: new Date().toISOString(), spam: false });
    setTriagemGrupo(null);
  }
  async function marcarGrupoSpam(waId: string) {
    await salvarContato(waId, { spam: true, spamPor: me?.id || null, spamEm: new Date().toISOString(), triadoEm: new Date().toISOString() });
    setTriagemGrupo(null); setSel(null);
  }
  // Cria um grupo de WhatsApp pela Evolution e já o mostra no inbox.
  async function criarGrupo(subject: string, participants: string[]): Promise<boolean> {
    if (!numeroSel) return false;
    try {
      const r = await fetch("/api/evolution-grupo-criar", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ instancia: numeroSel, subject, participants }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && (j as { ok?: boolean }).ok) {
        const gid = ((j as { groupId?: string }).groupId || "").replace(/\D/g, "");
        if (gid) { const waId = `g:${gid}`; await salvarContato(waId, { ehGrupo: true, nomeGrupo: subject, triadoEm: new Date().toISOString() }); setSel(waId); }
        else alert(`Grupo "${subject}" criado! Aparece no inbox assim que chegar a primeira mensagem.`);
        return true;
      }
      alert((j as { naoConfigurado?: boolean }).naoConfigurado ? "Evolution ainda não configurada (env vars na Vercel)." : ((j as { error?: string }).error || "Falha ao criar grupo."));
      return false;
    } catch (e) { alert("Falha ao criar grupo: " + (e instanceof Error ? e.message : "?")); return false; }
  }

  // Vincular/desvincular cliente do CRM.
  async function vincularCliente(clienteId: string | null) { if (sel) await salvarContato(sel, { clienteId }); }
  // Transferir a conversa pra outro atendente (+ registra no histórico).
  async function transferirPara(p: Pessoa, nota: string) {
    const alvo = transferWaId || sel;
    if (!alvo) return;
    // Ao transferir: passa pro novo dono, REABRE (se estava finalizada não pode
    // cair em "Finalizados") e marca como NÃO LIDA — pro novo dono ver na fila.
    await salvarContato(alvo, { atribuidoA: p.id, atribuidoNome: p.nome, finalizadoEm: null, finalizadoPor: null, naoLidaManual: true });
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
  // Finaliza o atendimento: sai das listas ativas → "Finalizados". Reabre
  // automático (volta pra pendentes) quando o cliente mandar nova mensagem.
  async function finalizarConversa(waId: string) {
    await salvarContato(waId, { finalizadoEm: new Date().toISOString(), finalizadoPor: me?.id || null });
    await addDoc(collection(db, "whatsappMensagens"), sanitizeForFirestore({
      waId, numeroId: numeroSel, direcao: "out", tipo: "sistema", sistema: true, lido: true,
      texto: `✅ ${me?.nome || "—"} finalizou o atendimento`, timestamp: new Date().toISOString(), recebidoEm: new Date().toISOString(), autorNome: me?.nome || null,
    }));
  }
  // Marca/desmarca contato como SPAM. Spam some das listas ativas e vai pro
  // filtro Spam.
  async function marcarSpam(waId: string) {
    const novoSpam = !spamDe(waId);
    if (novoSpam && !confirm("Marcar este contato como SPAM?\n\nEle sai das listas ativas (Pendentes/Minhas/Todas) e passa a aparecer só no filtro Spam.")) return;
    await salvarContato(waId, {
      spam: novoSpam,
      spamPor: novoSpam ? (me?.id || null) : null,
      spamEm: novoSpam ? new Date().toISOString() : null,
    });
  }
  // Reabertura manual (pelo atendente) — mantém o responsável. A reabertura por
  // mensagem do cliente acontece no webhook e devolve pra pendentes.
  async function reabrirConversa(waId: string) {
    await salvarContato(waId, { finalizadoEm: null, finalizadoPor: null });
    await addDoc(collection(db, "whatsappMensagens"), sanitizeForFirestore({
      waId, numeroId: numeroSel, direcao: "out", tipo: "sistema", sistema: true, lido: true,
      texto: `🔄 ${me?.nome || "—"} reabriu o atendimento`, timestamp: new Date().toISOString(), recebidoEm: new Date().toISOString(), autorNome: me?.nome || null,
    }));
  }

  // ── Ações sobre uma mensagem: reagir / editar / apagar (pra todos) ───────────
  async function acaoMsg(m: Msg, acao: "reagir" | "editar" | "apagar", extra: { reaction?: string; texto?: string } = {}): Promise<boolean> {
    if (!m.messageId) { alert("Essa mensagem é antiga (enviada antes dessa função) e não dá pra alterar."); return false; }
    const numero = m.numeroId || numeroSel;
    if (!numero) return false;
    try {
      const r = await fetch("/api/evolution-acao", {
        method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ instancia: numero, acao, remoteJid: `${soDig(m.waId)}@s.whatsapp.net`, id: m.messageId, fromMe: m.direcao === "out", to: soDig(m.waId), ...extra }),
      });
      const j = await r.json().catch(() => ({}));
      if (!(r.ok && (j as { ok?: boolean }).ok)) { alert((j as { naoConfigurado?: boolean }).naoConfigurado ? "Evolution não configurada." : ((j as { error?: string }).error || "Falha na ação.")); return false; }
      return true;
    } catch (e) { alert("Falha: " + (e instanceof Error ? e.message : "?")); return false; }
  }
  async function reagirMsg(m: Msg, emoji: string) {
    const novo = m.reacao === emoji ? "" : emoji;   // tocar no mesmo emoji remove a reação
    if (await acaoMsg(m, "reagir", { reaction: novo })) await updateDoc(doc(db, "whatsappMensagens", m.id), { reacao: novo || null }).catch(() => {});
  }
  async function editarMsg(m: Msg, novoTexto: string) {
    const t = novoTexto.trim();
    if (!t || t === (m.texto || "")) { setEditMsg(null); return; }
    if (await acaoMsg(m, "editar", { texto: t })) { await updateDoc(doc(db, "whatsappMensagens", m.id), { texto: t, editado: true }).catch(() => {}); }
    setEditMsg(null);
  }
  async function apagarMsg(m: Msg) {
    const ehMinha = m.direcao === "out";
    const msg = ehMinha
      ? "Apagar esta mensagem para o contato?\n\nEla some no WhatsApp dele, mas continua aqui na sua tela (riscada) pro seu controle."
      : "Apagar esta mensagem para todos? Some pra você e pro cliente — não tem 'apagar só pra mim'.";
    if (!confirm(msg)) return;
    if (await acaoMsg(m, "apagar")) {
      // Minha mensagem: revoga pro contato mas MANTÉM o texto/mídia aqui (riscado).
      // Mensagem do cliente: some dos dois lados (comportamento antigo).
      const patch = ehMinha ? { apagada: true, apagadaParaCliente: true } : { apagada: true, texto: "", midia: null, mime: null };
      await updateDoc(doc(db, "whatsappMensagens", m.id), patch).catch(() => {});
    }
  }

  // ── Resumo do atendimento (IA) — compartilhado entre "Passar contexto" e "Encaminhar" ──
  async function gerarResumo(): Promise<string> {
    if (!sel) return "";
    try {
      const msgs = thread.filter(m => !m.sistema && m.tipo !== "sistema" && m.texto).slice(-30).map(m => ({ de: m.direcao === "in" ? "cliente" : "atendente", texto: m.texto }));
      const info = [clienteSel ? `Cliente: ${clienteSel.nome}` : "", (contatoSel?.tagIds || []).map(id => tagById[id]?.nome).filter(Boolean).join(", ")].filter(Boolean).join(" · ");
      const r = await fetch("/api/whatsapp-resumo", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ contato: { nome: nomeSel, telefone: ehTelefoneBR(sel) ? foneBonito(sel) : "", info }, mensagens: msgs }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && typeof (j as { resumo?: string }).resumo === "string") return (j as { resumo: string }).resumo;
      const err = (j as { error?: string }).error; if (err) console.warn("[resumo]", err);
      return "";
    } catch { return ""; }
  }
  // ── "Passar contexto pra alguém externo" ──────────────────────────────────
  async function gerarResumoPc() {
    setPcCarregando(true);
    setPcResumo(await gerarResumo());
    setPcCarregando(false);
  }
  useEffect(() => {
    if (!passarCtx) return;
    setPcResumo(""); setPcRecado(""); setPcAnexar(false); setPcBusca(""); setPcDest(null);
    setPcAvisar(false); setPcFinalizar(false); setPcMsgCliente(MSG_CLIENTE_ENCAMINHO);
    void gerarResumoPc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passarCtx]);
  const pcSugestoes = useMemo(() => {
    const q = pcBusca.trim().toLowerCase(); const qd = soDig(pcBusca);
    if (!q && !qd) return [];
    const arr: { nome: string; telefone: string }[] = [];
    for (const c of clientes) if (c.telefone) arr.push({ nome: c.nome, telefone: c.telefone });
    for (const p of pessoas) if (p.whatsapp) arr.push({ nome: p.nome, telefone: p.whatsapp });
    for (const k in contatos) { const ct = contatos[k]; const nome = ct.nomeManual || ct.nomePush; if (nome && ct.waId && !ehGrupoWaId(ct.waId)) arr.push({ nome, telefone: ct.waId }); }
    const seen = new Set<string>(); const out: { nome: string; telefone: string }[] = [];
    for (const a of arr) { const key = soDig(a.telefone); if (!key || seen.has(key)) continue; if (a.nome.toLowerCase().includes(q) || (qd.length >= 4 && key.includes(qd))) { seen.add(key); out.push(a); } if (out.length >= 8) break; }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pcBusca, clientes, pessoas, contatos]);
  // Envia um texto pelo número atual e grava no thread do destino. Sem "assumir".
  async function enviarProgramatico(destinoWaId: string, texto: string, nome?: string | null): Promise<boolean> {
    if (!numeroSel) return false;
    const to = soDig(destinoWaId);
    try {
      const r = await fetch("/api/evolution-enviar", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ instancia: numeroSel, to, texto, autorNome: me?.nome || "" }) });
      const j = await r.json().catch(() => ({}));
      if (!(r.ok && (j as { ok?: boolean }).ok)) { alert((j as { error?: string }).error || "Falha ao enviar."); return false; }
      const mid = (j as { messageId?: string }).messageId || null;
      const docMsg = sanitizeForFirestore({ waId: destinoWaId, nome: nome || null, direcao: "out", tipo: "text", texto, timestamp: new Date().toISOString(), recebidoEm: new Date().toISOString(), lido: true, numeroId: numeroSel, autorNome: me?.nome || null, autorId: me?.id || null, status: 1, ...(mid ? { messageId: mid } : {}) });
      if (mid) await setDoc(doc(db, "whatsappMensagens", `${numeroSel}_${mid}`), docMsg, { merge: true }); else await addDoc(collection(db, "whatsappMensagens"), docMsg);
      return true;
    } catch (e) { alert("Falha ao enviar: " + (e instanceof Error ? e.message : "?")); return false; }
  }

  async function enviarPassarCtx() {
    const tel = soDig(pcDest?.telefone || pcBusca);
    if (!tel) { alert("Escolha ou digite o número de quem vai receber."); return; }
    if (!numeroSel || !sel) return;
    if (!pcResumo.trim() && !pcRecado.trim()) { alert("O resumo está vazio."); return; }
    setPcEnviando(true);
    try {
      let texto = "📋 *Resumo de atendimento*\n\n";
      texto += `Contato: ${nomeSel}${ehTelefoneBR(sel) ? ` (${foneBonito(sel)})` : ""}`;
      if (pcResumo.trim()) texto += "\n\n" + pcResumo.trim();
      if (pcRecado.trim()) texto += "\n\n" + pcRecado.trim();
      if (pcAnexar) {
        const recebidas = thread.filter(m => m.direcao === "in" && !m.sistema && m.texto).slice(-15).map(m => `• ${m.texto}`).join("\n");
        if (recebidas) texto += "\n\n— Mensagens do cliente —\n" + recebidas;
      }
      texto += `\n\n_Encaminhado por ${me?.nome || ""} via planejamento.app_`;
      if (!(await enviarProgramatico(tel, texto, pcDest?.nome))) { setPcEnviando(false); return; }
      if (pcDest?.nome) void salvarContato(tel, { nomeManual: pcDest.nome });
      // Mensagem automática ao cliente (revisada/aprovada no modal) — opcional.
      if (pcAvisar && pcMsgCliente.trim()) await enviarProgramatico(sel, pcMsgCliente.trim());
      await addDoc(collection(db, "whatsappMensagens"), sanitizeForFirestore({ waId: sel, numeroId: numeroSel, direcao: "out", tipo: "sistema", sistema: true, lido: true, texto: `📤 Contexto enviado para ${pcDest?.nome || foneBonito(tel)} por ${me?.nome || "—"}`, timestamp: new Date().toISOString(), recebidoEm: new Date().toISOString() }));
      if (pcFinalizar) await finalizarConversa(sel);
      setPassarCtx(false);
      setSel(tel);
    } catch (e) { alert("Falha: " + (e instanceof Error ? e.message : "?")); }
    finally { setPcEnviando(false); }
  }

  // ── "Encaminhar para outro número (interno)" ──────────────────────────────
  useEffect(() => {
    if (!encaminhar) return;
    setEncResumo(""); setEncObs(""); setEncAlvo(null); setEncAtendente(null); setEncCarregando(true);
    setEncAvisar(true); setEncFinalizar(true); setEncMsgCliente(MSG_CLIENTE_ENCAMINHO);
    setEncIncluirResumo(true);
    // Por padrão inclui todo o histórico visível (1ª mensagem selecionável em diante).
    setEncDesdeId(thread.filter(m => !m.sistema && m.tipo !== "sistema" && !m.apagada)[0]?.id ?? null);
    void gerarResumo().then(s => setEncResumo(s)).finally(() => setEncCarregando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encaminhar]);
  // Números que podem receber um encaminhamento (todos os ativos, menos o atual).
  const numerosDestino = useMemo(() => numeros.filter(n => n.ativo !== false && n.id !== numeroSel), [numeros, numeroSel]);
  const encAlvoObj = encAlvo ? numeros.find(n => n.id === encAlvo) : null;
  // Atendentes do número de destino (só faz sentido se ele for por atribuição).
  const encAtendentes = useMemo(() => {
    if (!encAlvoObj || encAlvoObj.modo === "livre") return [];
    const uids = encAlvoObj.usuariosIds || [];
    return pessoas.filter(p => uids.includes(p.id)).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [encAlvoObj, pessoas]);
  // Mensagens do histórico que dá pra encaminhar (fora avisos de sistema e apagadas).
  const encMsgsSelecionaveis = useMemo(() => thread.filter(m => !m.sistema && m.tipo !== "sistema" && !m.apagada), [thread]);
  const encIdx = useMemo(() => {
    const i = encMsgsSelecionaveis.findIndex(m => m.id === encDesdeId);
    return i >= 0 ? i : 0;
  }, [encMsgsSelecionaveis, encDesdeId]);
  const encIncluidas = useMemo(() => encMsgsSelecionaveis.slice(encIdx), [encMsgsSelecionaveis, encIdx]);
  async function enviarEncaminhar() {
    if (!sel || !numeroSel) return;
    if (!encAlvo) { alert("Escolha o número/setor de destino."); return; }
    const alvo = numeros.find(n => n.id === encAlvo);
    const clientePhone = soDig(sel);
    if (!clientePhone) { alert("Esta conversa não tem um telefone pra encaminhar."); return; }
    if (encIncluidas.length === 0 && !encResumo.trim()) { alert("Selecione ao menos uma mensagem (ou inclua o resumo) pra encaminhar."); return; }
    setEncEnviando(true);
    try {
      const atendente = encAtendente ? pessoas.find(p => p.id === encAtendente) : null;
      // Grava no inbox do destino: (1) cabeçalho curto de contexto, (2) o histórico
      // selecionado replayado COMO MENSAGENS (quem mandou + horário original), (3) o
      // resumo da IA no fim (opcional). Timestamps incrementais → ordem certa.
      const base = Date.now();
      const iso = (k: number) => new Date(base + k * 1000).toISOString();
      const batch = writeBatch(db);
      const novaMsg = (data: Record<string, unknown>) => batch.set(doc(collection(db, "whatsappMensagens")), sanitizeForFirestore(data));
      // (1) Cabeçalho — nota curta, não é o repasse inteiro.
      novaMsg({
        waId: clientePhone, numeroId: encAlvo, direcao: "out", tipo: "sistema", sistema: true, lido: true,
        texto: `↪ Conversa encaminhada de *${numeroSelObj?.nome || "outro número"}* por ${me?.nome || "—"}`
          + (atendente ? ` → atribuída a *${atendente.nome}*` : "")
          + (encObs.trim() ? `\n📝 ${encObs.trim()}` : ""),
        timestamp: iso(0), recebidoEm: iso(0),
      });
      // (2) Histórico selecionado, cada mensagem preservando autor + horário original.
      encIncluidas.forEach((m, i) => {
        const autorLabel = m.direcao === "in" ? (nomeSel || "Cliente") : (m.autorNome || numeroSelObj?.nome || "Atendente");
        novaMsg({
          waId: clientePhone, numeroId: encAlvo, direcao: m.direcao, tipo: "encaminhada", lido: true,
          texto: textoMostra(m), autorNome: autorLabel,
          origTimestamp: m.timestamp || m.recebidoEm || null,
          timestamp: iso(i + 1), recebidoEm: iso(i + 1),
        });
      });
      // (3) Resumo IA no fim (opcional).
      if (encIncluirResumo && encResumo.trim()) {
        novaMsg({
          waId: clientePhone, numeroId: encAlvo, direcao: "out", tipo: "sistema", sistema: true, lido: true,
          texto: `📋 Resumo do atendimento\n${encResumo.trim()}`, timestamp: iso(encIncluidas.length + 1), recebidoEm: iso(encIncluidas.length + 1),
        });
      }
      await batch.commit();
      // Semeia o nome do cliente + atribui direto (se escolheu atendente).
      const ck = foneKey(sel);
      // naoLidaManual é POR NÚMERO → grava no número de DESTINO (encAlvo), senão o
      // "auto-marcar lida" da origem apagava. nomeManual/atribuidoA seguem globais.
      const patch: Partial<WhatsappContato> = { naoLidaManual: true };
      if (nomeSel && ehTelefoneBR(sel) && !contatos[ck]?.nomeManual) patch.nomeManual = nomeSel;
      if (atendente) { patch.atribuidoA = atendente.id; patch.atribuidoNome = atendente.nome; }
      void salvarContato(clientePhone, patch, encAlvo);
      // Mensagem automática ao cliente (revisada/aprovada no modal) — opcional.
      if (encAvisar && encMsgCliente.trim()) await enviarProgramatico(sel, encMsgCliente.trim());
      // Rastro na conversa original.
      await addDoc(collection(db, "whatsappMensagens"), sanitizeForFirestore({
        waId: sel, numeroId: numeroSel, direcao: "out", tipo: "sistema", sistema: true, lido: true,
        texto: `↪ Encaminhado para *${alvo?.nome || "outro número"}* por ${me?.nome || "—"}`, timestamp: new Date().toISOString(), recebidoEm: new Date().toISOString(),
      }));
      if (encFinalizar) await finalizarConversa(sel);
      setEncaminhar(false);
      if (encFinalizar) setSel(null);
      alert(`Encaminhado para ${alvo?.nome || "o outro número"}${atendente ? ` — atribuída a ${atendente.nome}` : ` — aparece lá em "Sem responsável ainda"`}, com o contexto.`);
    } catch (e) { alert("Falha: " + (e instanceof Error ? e.message : "?")); }
    finally { setEncEnviando(false); }
  }

  // Render de UMA linha da lista (reusado na lista plana e nos blocos do Início).
  // mostrarEspera = exibe o contador "tempo sem resposta" (bloco Aguardando você).
  const linhaConversa = (c: { waId: string; nome?: string | null; ultima: Msg; naoLidas: number }, mostrarEspera = false) => {
    const cont = contatos[foneKey(c.waId)];
    const grupo = ehGrupoWaId(c.waId) || !!cont?.ehGrupo;
    const cTags = (cont?.tagIds || []).map(id => tagById[id]).filter(Boolean) as WhatsappTag[];
    const naoLida = c.naoLidas > 0 || naoLidaManualDe(c.waId);
    const atribuido = grupo ? (cont?.atendentesNomes || []).join(", ") : cont?.atribuidoNome;
    const espera = mostrarEspera && c.ultima.direcao === "in" ? tempoEsperaLabel(agora - new Date(c.ultima.timestamp || 0).getTime()) : null;
    return (
      <ConversaItem key={c.waId} naoLida={naoLida} temDono={temResponsavel(c.waId)}
        onAbrir={() => { setSel(c.waId); setDetalhes(false); if (!numeroLivre && grupo && !triadoDe(c.waId)) abrirTriagem(c.waId); }}
        onNaoLida={() => void marcarNaoLida(c.waId)}
        onLida={() => void marcarLida(c.waId)}
        onTransferir={() => { setTransferWaId(c.waId); setTransferir(true); }}
        podeResponder={podeResponder}>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0 ${grupo ? "bg-indigo-50 dark:bg-indigo-900/20" : "bg-emerald-50 dark:bg-emerald-900/20"}`}>{grupo ? "👥" : "💬"}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`truncate ${naoLida ? "font-bold text-gray-900 dark:text-gray-50" : "font-medium text-gray-900 dark:text-gray-100"}`}>{nomeConversa(c.waId, c.nome)}</span>
            {cTags.map(t => <span key={t.id} className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: t.cor || "#6366f1" }} title={t.nome} />)}
          </div>
          <div className={`text-xs truncate ${naoLida ? "text-gray-700 dark:text-gray-200 font-medium" : "text-gray-500"}`}>{c.ultima.direcao === "out" ? "Você: " : ""}{textoMostra(c.ultima)}</div>
          {atribuido && <div className="text-[10px] text-indigo-500 dark:text-indigo-300 truncate">🙋 {atribuido}</div>}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[10px] text-gray-400">{hhmm(c.ultima.timestamp)}</span>
          {espera && <span className={`text-[10px] font-semibold ${espera.cor}`}>⏱ {espera.txt}</span>}
          {naoLida && <span className="min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center text-[10px] font-bold rounded-full bg-rose-500 text-white">{c.naoLidas > 0 ? c.naoLidas : ""}</span>}
        </div>
      </ConversaItem>
    );
  };

  const abaEfetiva = embutido ? "conversas" : tab;
  return (
    <div className={embutido ? "" : "max-w-4xl"}>
      {!embutido && (
        <div className="mb-3">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">💬 WhatsApp
            <span className={`text-[11px] font-semibold inline-flex items-center gap-1 ${sincronizando ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
              {sincronizando
                ? <><span className="w-2.5 h-2.5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />conectando…</>
                : <><span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />AO VIVO</>}
            </span>
          </h1>
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
      {!sel && <div className="px-4 pt-3">
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
            <span className={`text-[11px] font-semibold inline-flex items-center gap-1 px-1 ${sincronizando ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}
              title={sincronizando ? "Conectando ao servidor… (mostrando o que já estava salvo)" : "Ao vivo — recebendo e enviando em tempo real"}>
              {sincronizando
                ? <><span className="w-3 h-3 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />conectando…</>
                : <><span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />AO VIVO</>}
            </span>
            {/* Notificações do navegador — SEMPRE visível, refletindo o estado (nunca some). */}
            {typeof Notification !== "undefined" && (
              <button type="button"
                onClick={() => {
                  if (notifPerm === "granted") { alert("As notificações já estão ativas neste navegador. Se não estiver recebendo, verifique se o navegador/computador está com as notificações do site permitidas (cadeado na barra de endereço + Ajustes do sistema → Notificações)."); return; }
                  try {
                    void Notification.requestPermission().then(p => {
                      setNotifPerm(p);
                      // Já negado: o navegador não pergunta de novo — orienta a liberar manualmente.
                      if (p === "denied") alert("As notificações estão bloqueadas para este site no navegador.\n\nPara ativar: clique no cadeado/ajustes do site na barra de endereço → Notificações → Permitir, e recarregue a página.");
                    });
                  } catch { /* ignore */ }
                }}
                title="Receber notificação no computador quando chegar mensagem nova"
                className={notifPerm === "granted"
                  ? "text-[11px] px-2 py-1 rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                  : notifPerm === "denied"
                  ? "text-[11px] px-2 py-1 rounded-lg text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                  : "text-xs font-semibold px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20"}>
                🔔 {notifPerm === "granted" ? "Notificações ativas" : notifPerm === "denied" ? "Notificações bloqueadas" : "Ativar notificações"}
              </button>
            )}
            {podeResponder && numeroSel && <div className="ml-auto flex items-center gap-1.5 shrink-0">
              <button type="button" onClick={() => setNovoGrupo(true)} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20">👥 Novo grupo</button>
              <button type="button" onClick={() => setNovaConversa(true)} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">＋ Nova conversa</button>
            </div>}
          </div>
          {numerosVisiveis.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500 mb-3">
              {numeros.length === 0 ? (isMaster ? "Nenhum número configurado ainda. Vá na aba Configuração pra adicionar e conectar." : "Nenhum número de WhatsApp configurado.") : "Você não tem número de WhatsApp atribuído."}
            </div>
          )}

          {/* Filtro — chips mudam conforme o modo do número (atribuição × livre) */}
          {numerosVisiveis.length > 0 && (
            <div className="flex mb-2 p-0.5 rounded-lg bg-gray-100 dark:bg-gray-800/60">
              {(numeroLivre
                ? [
                    ["conversas", "Conversas", naoLidasLivre, conversasLivre],
                    ["finalizados", "Finalizados", contFinalizadas, finalizadasList],
                    ["spam", "🚫 Spam", contSpam, spamList],
                  ]
                : [
                    ["inicio", "Início", contInicio, [...minhas, ...semRespAinda]],
                    ["outras", "Outras", contOutras, [...deOutros, ...finalizadasList]],
                    ["spam", "🚫 Spam", contSpam, spamList],
                  ]
              ).map(([v, label, cont, lista]) => {
                const nl = temNaoLida(lista as { waId: string; naoLidas: number }[]);
                const ativo = abaAtual === v;
                const cls = nl
                  ? (ativo ? "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200 shadow-sm" : "bg-rose-50 text-rose-600 dark:bg-rose-900/25 dark:text-rose-300")
                  : (ativo ? "bg-white dark:bg-gray-900 text-emerald-600 dark:text-emerald-300 shadow-sm" : "text-gray-500 dark:text-gray-400");
                return (
                  <button key={v as string} type="button" onClick={() => setFiltroAtrib(v as typeof filtroAtrib)}
                    className={`flex-1 min-w-0 text-xs font-semibold px-1 py-1.5 rounded-md transition-colors truncate ${cls}`}>
                    {label as string}{cont ? ` (${cont as number})` : ""}
                  </button>
                );
              })}
            </div>
          )}

          {/* Busca por contato / conversa (número aberto) */}
          <div className="relative mb-2.5">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none text-sm">🔍</span>
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar contato, número ou mensagem…"
              className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
            {busca && (
              <button type="button" onClick={() => setBusca("")} aria-label="Limpar busca"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center text-sm leading-none">×</button>
            )}
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
      </div>}

      {!sel ? (
        numeroLivre ? (
          // ── Modo LIVRE: lista única (não-lidas no topo), + Finalizados/Spam ──
          (() => {
            const lista = abaAtual === "finalizados" ? finalizadasList : abaAtual === "spam" ? spamList : conversasLivre;
            if (lista.length === 0) return (
              <div className="mx-4 mt-2 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">{conversas.length === 0 ? "Nenhuma mensagem recebida ainda. Quando alguém mandar no WhatsApp do planejamento.app, aparece aqui." : abaAtual === "finalizados" ? "Nenhuma conversa finalizada." : abaAtual === "spam" ? "Nenhuma conversa marcada como spam." : "🎉 Nenhuma conversa em aberto."}</div>
            );
            return <div className="border-y border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">{lista.map(c => linhaConversa(c, abaAtual === "conversas"))}</div>;
          })()
        ) : abaAtual === "spam" ? (
          spamList.length === 0 ? (
            <div className="mx-4 mt-2 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">Nenhuma conversa marcada como spam.</div>
          ) : (
            <div className="border-y border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">{spamList.map(c => linhaConversa(c))}</div>
          )
        ) : abaAtual === "outras" ? (
          (deOutros.length + finalizadasList.length) === 0 ? (
            <div className="mx-4 mt-2 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">Nada aqui — nenhuma conversa de outros nem finalizada.</div>
          ) : (
            // 2 colunas: esquerda = De outros (atribuídas a outra pessoa), direita = Finalizadas.
            <div className="grid grid-cols-1 md:grid-cols-2 md:gap-px md:bg-gray-200 md:dark:bg-gray-800 border-t border-gray-200 dark:border-gray-800">
              <div className="bg-white dark:bg-gray-950">
                <div className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-900/40">👥 De outros ({deOutros.length})</div>
                {deOutros.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-gray-400">Ninguém atendendo além de você.</div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">{deOutros.map(c => linhaConversa(c, true))}</div>
                )}
              </div>
              <div className="bg-white dark:bg-gray-950">
                <div className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800/40 border-b border-gray-200 dark:border-gray-700">✅ Finalizadas ({finalizadasList.length})</div>
                {finalizadasList.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-gray-400">Nenhuma conversa finalizada.</div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">{finalizadasList.map(c => linhaConversa(c))}</div>
                )}
              </div>
            </div>
          )
        ) : (
          // ── Início (atribuição): 2 colunas — Sem responsável | Minhas ──
          (minhas.length + semRespAinda.length) === 0 ? (
            <div className="mx-4 mt-2 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">{conversas.length === 0 ? "Nenhuma mensagem recebida ainda. Quando alguém mandar no WhatsApp do planejamento.app, aparece aqui." : "🎉 Tudo em dia — nada aguardando você e nada sem responsável."}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 md:gap-px md:bg-gray-200 md:dark:bg-gray-800 border-t border-gray-200 dark:border-gray-800">
              <div className="bg-white dark:bg-gray-950">
                <div className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-900/40">🟡 Sem responsável ainda ({semRespAinda.length})</div>
                {semRespAinda.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-gray-400">Ninguém esperando 🎉</div>
                ) : (
                  <>
                    <div className="px-4 py-2 text-xs text-amber-800 dark:text-amber-200 bg-amber-50/60 dark:bg-amber-900/10">{semRespAinda.length === 1 ? "1 conversa esperando alguém assumir. É sua? Toque para assumir." : `${semRespAinda.length} conversas esperando alguém. Alguma é sua? Toque para assumir.`}</div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-800">{semRespAinda.map(c => linhaConversa(c, true))}</div>
                  </>
                )}
              </div>
              <div className="bg-white dark:bg-gray-950">
                <div className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-900/20 border-b border-sky-100 dark:border-sky-900/40">🔵 Minhas ({minhas.length})</div>
                {minhas.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-gray-400">Você não tem conversas atribuídas.</div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">{minhas.map(c => linhaConversa(c, true))}</div>
                )}
              </div>
            </div>
          )
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
                {ehGrupoWaId(sel || "") ? (
                  <>👥 Grupo{(contatoSel?.participantes?.length || 0) > 0 ? ` · ${contatoSel!.participantes!.length} participantes` : ""} <InfoBadge texto="Só conseguimos ver quem participa do grupo depois que a pessoa envia uma mensagem. A lista pode estar incompleta." /></>
                ) : (
                  <>{foneBonito(contatoSel?.telefoneManual || sel)}{contatoSel?.telefoneManual && <span className="text-gray-400"> ✎</span>}{!ehTelefoneBR(contatoSel?.telefoneManual || sel || "") && !clienteSel && !pessoaSel && !contatoSel?.nomeManual && <> <InfoBadge texto="Por privacidade do WhatsApp, ainda não temos o número nem o nome desta pessoa. Isso aparece assim que ela te enviar uma mensagem." /></>}</>
                )}
                {clienteSel && <span className="text-emerald-600 dark:text-emerald-300"> · 🧑 {clienteSel.nome}</span>}
                {pessoaSel && <span className="text-indigo-600 dark:text-indigo-300"> · 👤 {pessoaSel.nome}</span>}
                {contatoSel?.atribuidoNome && <span> · 🙋 {contatoSel.atribuidoNome}</span>}
              </div>
            </div>
            {podeResponder && !ehGrupoWaId(sel || "") && <button type="button" onClick={() => setEditarNum(true)} title="Editar contato (nome/número)" className="w-9 h-9 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center shrink-0">✏️</button>}
            {podeResponder && !numeroLivre && <button type="button" onClick={() => { setTransferWaId(null); setTransferir(true); }} title={contatoSel?.atribuidoA ? "Transferir" : "Atribuir"} className="w-9 h-9 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center shrink-0">↪</button>}
            {podeResponder && !ehGrupoWaId(sel || "") && <button type="button" onClick={() => setPassarCtx(true)} title="Passar contexto pra alguém externo" className="w-9 h-9 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center shrink-0">📤</button>}
            {podeResponder && !ehGrupoWaId(sel || "") && numerosDestino.length > 0 && <button type="button" onClick={() => setEncaminhar(true)} title="Encaminhar para outro número/setor" className="w-9 h-9 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center shrink-0">🔀</button>}
            <button type="button" onClick={() => marcarNaoLida(sel)} title="Marcar como não lida" className="w-9 h-9 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center shrink-0">🔵</button>
            {podeVincular && <button type="button" onClick={() => setDetalhes(v => !v)} title="Detalhes" className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${detalhes ? "text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30" : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"}`}>ⓘ</button>}
          </div>

          {/* Barra de atribuição (responsável) */}
          {(() => {
            // Grupo: atendentes (1+) em vez de responsável único. Só no modo COM
            // ATRIBUIÇÃO — em livre, grupo é só lido/não lido (cai na barra enxuta).
            if (!numeroLivre && ehGrupoWaId(sel || "")) {
              const ats = contatoSel?.atendentesNomes || [];
              const fin = finalizadaDe(sel || "");
              return (
                <div className={`flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-800 text-xs shrink-0 ${fin ? "bg-gray-100 dark:bg-gray-800/60" : ats.length ? "bg-emerald-50 dark:bg-emerald-900/20" : "bg-amber-50 dark:bg-amber-900/20"}`}>
                  <span className="truncate">
                    {fin ? <span className="text-gray-600 dark:text-gray-300">✅ Finalizado <span className="text-gray-400">· reabre quando alguém escrever</span></span>
                      : ats.length ? <span className="text-emerald-700 dark:text-emerald-300">👥 Atende: <b>{ats.join(", ")}</b></span>
                      : <span className="text-amber-700 dark:text-amber-300">⏳ Sem atendente — defina quem atende esse grupo</span>}
                  </span>
                  {podeResponder && (
                    <div className="ml-auto shrink-0 flex items-center gap-1.5">
                      <button type="button" onClick={() => abrirTriagem(sel!)} className="px-2.5 py-1 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300">{ats.length ? "Editar atendentes" : "Definir atendentes"}</button>
                      {!fin
                        ? <button type="button" onClick={() => void finalizarConversa(sel!)} className="px-2.5 py-1 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300">✅ Finalizar</button>
                        : <button type="button" onClick={() => void reabrirConversa(sel!)} className="px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">🔄 Reabrir</button>}
                      {spamDe(sel || "")
                        ? <button type="button" onClick={() => void marcarSpam(sel!)} title="Tirar do spam" className="px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300">↩ Não é spam</button>
                        : <button type="button" onClick={() => void marcarGrupoSpam(sel!)} className="px-2.5 py-1 rounded-lg border border-rose-300 dark:border-rose-700 text-rose-600 dark:text-rose-300">🚫 Spam</button>}
                    </div>
                  )}
                </div>
              );
            }
            const dono = contatoSel?.atribuidoA || null;
            const minha = dono === me?.id;
            const finalizada = finalizadaDe(sel || "");
            // Modo livre: sem atribuição — barra enxuta (quem vê responde).
            if (numeroLivre && !finalizada) {
              return (
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-800 text-xs shrink-0 bg-gray-50 dark:bg-gray-800/40">
                  <span className="truncate text-gray-500 dark:text-gray-400">💬 Quem vê responde · sem responsável fixo</span>
                  {podeResponder && (
                    <div className="ml-auto shrink-0 flex items-center gap-1.5">
                      <button type="button" onClick={() => void finalizarConversa(sel)} className="px-2.5 py-1 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300">✅ Finalizar</button>
                      <button type="button" onClick={() => void marcarSpam(sel)} className={`px-2.5 py-1 rounded-lg border ${spamDe(sel) ? "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300" : "border-rose-300 dark:border-rose-700 text-rose-600 dark:text-rose-300"}`}>{spamDe(sel) ? "↩ Não é spam" : "🚫 Spam"}</button>
                    </div>
                  )}
                </div>
              );
            }
            if (finalizada) {
              return (
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-800 text-xs shrink-0 bg-gray-100 dark:bg-gray-800/60">
                  <span className="truncate text-gray-600 dark:text-gray-300">✅ Atendimento finalizado <span className="text-gray-400">· reabre quando o cliente escrever</span></span>
                  {podeResponder && (
                    <div className="ml-auto shrink-0">
                      <button type="button" onClick={() => void reabrirConversa(sel)} className="px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">🔄 Reabrir</button>
                    </div>
                  )}
                </div>
              );
            }
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
                    <button type="button" onClick={() => void finalizarConversa(sel)} className="px-2.5 py-1 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300">✅ Finalizar</button>
                    <button type="button" onClick={() => void marcarSpam(sel)} title={spamDe(sel) ? "Tirar do spam" : "Marcar contato como spam"}
                      className={`px-2.5 py-1 rounded-lg border ${spamDe(sel) ? "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300" : "border-rose-300 dark:border-rose-700 text-rose-600 dark:text-rose-300"}`}>
                      {spamDe(sel) ? "↩ Não é spam" : "🚫 Spam"}
                    </button>
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
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Atendente padrão</label>
                <PessoaPicker pessoas={pessoas.filter(p => { const n = numeros.find(x => x.id === numeroSel); const uids = n?.usuariosIds || []; return uids.length === 0 || uids.includes(p.id); })} valueId={contatoSel?.atendentePadrao || null} autoMatch={null}
                  onChange={id => void salvarContato(sel, { atendentePadrao: id, atendentePadraoNome: id ? (pessoas.find(p => p.id === id)?.nome || null) : null })} />
                <p className="text-[11px] text-gray-400 mt-1">Quando este contato manda mensagem e a conversa está <b>pendente</b>, é atribuída automaticamente a essa pessoa.</p>
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
            <div className="flex justify-center pb-1">
              <div className="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800/60 rounded-full px-3 py-1 text-center max-w-[90%]">As mensagens começam de quando este número foi ligado ao sistema. Conversas mais antigas ficam só no celular.</div>
            </div>
            {thread.map(m => m.sistema || m.tipo === "sistema" ? (
              <div key={m.id} className="flex justify-center">
                <div className="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800/60 rounded-full px-3 py-1 text-center max-w-[90%] whitespace-pre-wrap">{m.texto} · {hhmm(m.timestamp)}</div>
              </div>
            ) : m.tipo === "encaminhada" ? (
              <div key={m.id} className={`flex ${m.direcao === "out" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-2.5 py-1.5 text-sm border border-dashed ${m.direcao === "out" ? "bg-emerald-50/70 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-800 rounded-br-md" : "bg-gray-50 dark:bg-gray-800/70 border-gray-300 dark:border-gray-700 rounded-bl-md"}`}>
                  <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-0.5 flex items-center gap-1">
                    <span className="text-emerald-600 dark:text-emerald-400">↪</span>{m.autorNome || (m.direcao === "in" ? "Cliente" : "Atendente")}{m.origTimestamp && <span className="font-normal text-gray-400"> · {hhmm(m.origTimestamp)}</span>}
                  </div>
                  <div className="whitespace-pre-wrap break-words text-gray-800 dark:text-gray-100">{m.texto}</div>
                </div>
              </div>
            ) : (
              <div key={m.id} className={`flex group ${m.direcao === "out" ? "justify-end" : "justify-start"}`}>
                <div className="relative max-w-[80%]">
                  <div className={`rounded-2xl px-2.5 py-1.5 text-sm shadow-sm ${m.direcao === "out" ? "bg-[#dcf8c6] dark:bg-emerald-900/40 text-gray-900 dark:text-gray-100 rounded-br-md" : "bg-sky-50 dark:bg-sky-900/30 text-gray-900 dark:text-gray-100 rounded-bl-md"} ${m.reacao && !m.apagada ? "mb-2" : ""}`}>
                    {(m.quotedTexto || m.quotedId) && !m.apagada && (
                      <div className="mb-1 rounded-md border-l-2 border-emerald-400 bg-black/[0.05] dark:bg-white/[0.07] px-2 py-1">
                        {m.quotedAutor && !/^\d+$/.test(m.quotedAutor) && <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 leading-tight">{m.quotedAutor}</div>}
                        <div className="text-[12px] text-gray-600 dark:text-gray-300 truncate">{m.quotedTexto || "mensagem citada"}</div>
                      </div>
                    )}
                    {m.direcao === "out" && m.autorNome && <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 mb-0.5">{m.autorNome}{m.viaAparelho && <> <InfoBadge texto="Enviada direto pelo celular, fora do sistema." /></>}</div>}
                    {m.direcao === "in" && m.ehGrupo && m.autorNome && <div className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-300 mb-0.5">{m.autorNome}</div>}
                    {m.direcao === "in" && m.ehGrupo && !m.autorNome && <div className="text-[11px] font-semibold text-gray-400 mb-0.5 inline-flex items-center gap-1">Participante <InfoBadge texto="Ainda não sabemos quem é. O nome aparece quando essa pessoa fala com você em particular." /></div>}
                    {m.apagada ? (
                      m.apagadaParaCliente && (m.texto || "").trim() ? (
                        // Você apagou pro contato, mas fica aqui riscado pro seu controle.
                        <div>
                          <div className="whitespace-pre-wrap break-words line-through text-gray-500 dark:text-gray-400">{m.texto}</div>
                          <div className="text-[10px] italic text-rose-500 dark:text-rose-400 mt-0.5">🚫 apagada pro contato (só você vê)</div>
                        </div>
                      ) : (
                        <div className="italic text-gray-400 dark:text-gray-500">🚫 Mensagem apagada</div>
                      )
                    ) : editMsg?.id === m.id ? (
                      <div className="space-y-1.5 min-w-[200px]">
                        <textarea autoFocus value={editMsg.texto} onChange={e => setEditMsg({ id: m.id, texto: e.target.value })} rows={2}
                          className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 outline-none resize-none"
                          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void editarMsg(m, editMsg.texto); } if (e.key === "Escape") setEditMsg(null); }} />
                        <div className="flex justify-end gap-1.5 text-xs">
                          <button type="button" onClick={() => setEditMsg(null)} className="px-2 py-0.5 rounded text-gray-500">Cancelar</button>
                          <button type="button" onClick={() => void editarMsg(m, editMsg.texto)} className="px-2 py-0.5 rounded bg-emerald-600 text-white font-medium">Salvar</button>
                        </div>
                      </div>
                    ) : (() => {
                      const src = m.midiaUrl || m.midia;
                      const isImg = src && (m.mime?.startsWith("image") || m.tipo === "stickerMessage");
                      const isVid = src && (m.mime?.startsWith("video") || m.tipo === "videoMessage");
                      const isAud = src && (m.mime?.startsWith("audio") || m.tipo === "audioMessage");
                      const isDoc = src && m.tipo === "documentMessage";
                      const rotuloAuto = ["🖼️ Imagem", "🎬 Vídeo", "🎤 Áudio"].includes(m.texto || "");
                      const nomeDoc = m.midiaNome || m.texto?.replace(/^📄 /, "") || "documento";
                      const ehReacao = m.tipo === "encReactionMessage" || m.tipo === "reactionMessage";
                      const midiaSemPrevia = !src && ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"].includes(m.tipo || "");
                      return (
                        <>
                          {isImg && <img src={src} alt={m.texto || "imagem"} className={`rounded-lg ${m.tipo === "stickerMessage" ? "w-32 h-32 object-contain" : "max-w-full max-h-64 object-contain"}`} />}
                          {isVid && <video src={src} controls className="rounded-lg max-w-full max-h-64" />}
                          {isAud && <audio src={src} controls className="max-w-[220px]" />}
                          {isDoc && (
                            <a href={src} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-lg bg-black/[0.06] dark:bg-white/10 px-2.5 py-2 no-underline hover:bg-black/10 dark:hover:bg-white/[0.15] transition-colors max-w-[240px]">
                              <span className="w-9 h-9 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-300 flex items-center justify-center shrink-0 text-lg">📄</span>
                              <span className="min-w-0 leading-tight">
                                <span className="block text-[13px] font-medium text-gray-800 dark:text-gray-100 truncate">{nomeDoc}</span>
                                <span className="block text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{(nomeDoc.split(".").pop() || "arquivo").slice(0, 5)}</span>
                              </span>
                            </a>
                          )}
                          {!isImg && !isVid && !isAud && !isDoc && <div className="whitespace-pre-wrap break-words">{textoMostra(m)}{ehReacao && <> <InfoBadge texto="Esta pessoa reagiu com um emoji. O WhatsApp protege as reações, então não dá pra mostrar qual foi nem em qual mensagem." /></>}{midiaSemPrevia && <> <InfoBadge texto="Arquivo grande demais para mostrar aqui. Ele foi entregue normalmente — abra no WhatsApp do celular para ver." /></>}</div>}
                          {(isImg || isVid) && m.texto && !rotuloAuto && <div className="whitespace-pre-wrap break-words mt-1">{m.texto}</div>}
                          {isDoc && m.texto && !m.texto.startsWith("📄") && m.texto !== nomeDoc && <div className="whitespace-pre-wrap break-words mt-1">{m.texto}</div>}
                        </>
                      );
                    })()}
                    <div className="text-[10px] text-gray-400 mt-0.5 text-right">{m.editado && !m.apagada && <span className="italic">editado · </span>}{hhmm(m.timestamp)}{m.direcao === "out" && !m.apagada && (() => {
                      if (m.falhou) return <span className="ml-0.5 text-rose-500 font-semibold" title="O WhatsApp não entregou esta mensagem (falha no envio). Reconecte o número (QR) e tente de novo.">❌ não entregue</span>;
                      const nivel = m.status ?? 1;   // enviado por padrão
                      // status 0 = ainda não confirmado. Se veio de timeout (incerto),
                      // a msg PODE ter saído; o webhook confirma e vira ✓.
                      if (nivel <= 0) return <span className="ml-0.5 text-amber-500" title={m.incerto ? "Envio não confirmado — a Evolution demorou a responder. A mensagem pode ter sido entregue; aguarde a confirmação (vira ✓). Se ficar assim, reenvie." : "Enviando…"}>⏳ {m.incerto ? "não confirmada" : "enviando"}</span>;
                      return <span className={`ml-0.5 ${nivel >= 3 ? "text-sky-500" : "text-gray-400"}`} title={nivel >= 3 ? "Lida" : nivel >= 2 ? "Entregue" : "Enviada"}>{nivel >= 2 ? "✓✓" : "✓"}</span>;
                    })()}</div>
                  </div>

                  {/* Reação no canto da bolha */}
                  {m.reacao && !m.apagada && (
                    <div className={`absolute -bottom-2.5 ${m.direcao === "out" ? "right-2" : "left-2"} bg-white dark:bg-gray-700 rounded-full px-1 py-0.5 text-xs shadow border border-gray-200 dark:border-gray-600 leading-none`}>{m.reacao}</div>
                  )}

                  {/* Botão de ações (aparece no hover) */}
                  {podeResponder && !m.apagada && editMsg?.id !== m.id && (
                    <button type="button" onClick={() => setAcaoMsgId(acaoMsgId === m.id ? null : m.id)}
                      className={`absolute top-0 ${m.direcao === "out" ? "-left-7" : "-right-7"} w-6 h-6 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center text-sm opacity-0 group-hover:opacity-100 ${acaoMsgId === m.id ? "opacity-100" : ""}`} title="Ações">⋯</button>
                  )}

                  {/* Popover de ações */}
                  {acaoMsgId === m.id && (
                    <div className={`absolute z-20 top-6 ${m.direcao === "out" ? "right-0" : "left-0"} bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-1.5 w-max`}>
                      <div className="flex gap-0.5 mb-1">
                        {["👍", "❤️", "😂", "😮", "😢", "🙏"].map(e => (
                          <button key={e} type="button" onClick={() => { void reagirMsg(m, e); setAcaoMsgId(null); }}
                            className={`w-8 h-8 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-lg flex items-center justify-center ${m.reacao === e ? "bg-gray-100 dark:bg-gray-700" : ""}`}>{e}</button>
                        ))}
                      </div>
                      <button type="button" onClick={() => { setRespondendo(m); setAcaoMsgId(null); taRef.current?.focus(); }} className="w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200">↩️ Responder</button>
                      {m.direcao === "out" && !m.midia && (
                        <button type="button" onClick={() => { setEditMsg({ id: m.id, texto: m.texto || "" }); setAcaoMsgId(null); }} className="w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200">✏️ Editar</button>
                      )}
                      {m.direcao === "out" && (
                        <button type="button" onClick={() => { void apagarMsg(m); setAcaoMsgId(null); }} className="w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20 text-rose-600 dark:text-rose-400">🗑️ Apagar para todos</button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {acaoMsgId && <div className="fixed inset-0 z-10" onClick={() => setAcaoMsgId(null)} />}
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

              {/* Picker de @ marcar (grupo) — acionado ao digitar "@" no campo */}
              {menMatch && menCandidatos.length > 0 && (
                <div className="mb-1.5 max-h-48 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
                  <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100 dark:border-gray-800">Marcar no grupo</div>
                  {menCandidatos.map(p => (
                    <button key={p.numero} type="button" onClick={() => inserirMencao(p)} className="w-full flex items-center gap-2 text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <span className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xs font-semibold shrink-0">{(p.nome || "?")[0].toUpperCase()}</span>
                      <span className="min-w-0"><span className="text-sm text-gray-900 dark:text-gray-100 truncate block">{p.nome}</span><span className="text-[11px] text-gray-400">+{p.numero}</span></span>
                    </button>
                  ))}
                </div>
              )}

              {respondendo && !gravando && (
                <div className="mb-1.5 flex items-start gap-2 rounded-lg border-l-2 border-emerald-500 bg-gray-50 dark:bg-gray-800/60 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">↩️ Respondendo {respondendo.direcao === "out" ? (respondendo.autorNome || "você") : (respondendo.autorNome || nomeSel || "cliente")}</div>
                    <div className="text-[12px] text-gray-600 dark:text-gray-300 truncate">{textoMostra(respondendo)}</div>
                  </div>
                  <button type="button" onClick={() => setRespondendo(null)} className="shrink-0 text-gray-400 hover:text-gray-600 text-sm" title="Cancelar resposta">✕</button>
                </div>
              )}
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
      {novoGrupo && <NovoGrupoModal pessoas={pessoas} onCriar={criarGrupo} onClose={() => setNovoGrupo(false)} />}
      {passarCtx && sel && (
        <Modal title="📤 Passar contexto pra alguém" onClose={() => setPassarCtx(false)} maxWidth="max-w-lg">
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Para quem</label>
              {pcDest ? (
                <div className="mt-1 flex items-center gap-2 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2">
                  <span className="text-sm flex-1 min-w-0 truncate">{pcDest.nome || foneBonito(pcDest.telefone)}{pcDest.nome && <span className="text-gray-400"> · {foneBonito(pcDest.telefone)}</span>}</span>
                  <button type="button" onClick={() => { setPcDest(null); setPcBusca(""); }} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
                </div>
              ) : (
                <div className="relative">
                  <input value={pcBusca} onChange={e => setPcBusca(e.target.value)} placeholder="Buscar por nome ou digitar o número…" className="w-full mt-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm outline-none" />
                  {pcSugestoes.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-lg max-h-52 overflow-y-auto">
                      {pcSugestoes.map((s, i) => (
                        <button key={i} type="button" onClick={() => { setPcDest(s); setPcBusca(""); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                          <div className="text-sm font-medium truncate">{s.nome}</div>
                          <div className="text-[11px] text-gray-400">{foneBonito(s.telefone)}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  {soDig(pcBusca).length >= 8 && pcSugestoes.length === 0 && (
                    <button type="button" onClick={() => setPcDest({ telefone: pcBusca })} className="mt-1 text-xs text-emerald-600 dark:text-emerald-300 hover:underline">Usar o número {foneBonito(pcBusca)}</button>
                  )}
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Resumo (IA) — edite à vontade</label>
                <button type="button" onClick={() => void gerarResumoPc()} disabled={pcCarregando} className="text-[11px] text-indigo-600 dark:text-indigo-300 hover:underline disabled:opacity-50">{pcCarregando ? "gerando…" : "↻ Regenerar"}</button>
              </div>
              <textarea value={pcResumo} onChange={e => setPcResumo(e.target.value)} rows={5} placeholder={pcCarregando ? "Gerando resumo…" : "Resumo do atendimento…"} className="w-full mt-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm outline-none resize-none" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Recado (opcional)</label>
              <input value={pcRecado} onChange={e => setPcRecado(e.target.value)} placeholder="Ex.: consegue passar o preço até amanhã?" className="w-full mt-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm outline-none" />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <input type="checkbox" checked={pcAnexar} onChange={e => setPcAnexar(e.target.checked)} />
              Anexar as últimas mensagens do cliente na íntegra
            </label>
            <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input type="checkbox" checked={pcFinalizar} onChange={e => setPcFinalizar(e.target.checked)} />
                Finalizar esta conversa
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input type="checkbox" checked={pcAvisar} onChange={e => setPcAvisar(e.target.checked)} />
                Avisar o cliente (mensagem automática)
              </label>
              {pcAvisar && <textarea value={pcMsgCliente} onChange={e => setPcMsgCliente(e.target.value)} rows={2} placeholder="Mensagem enviada ao cliente…" className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm outline-none resize-none" />}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setPassarCtx(false)} className="px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300">Cancelar</button>
              <button type="button" onClick={() => void enviarPassarCtx()} disabled={pcEnviando || (!pcDest && soDig(pcBusca).length < 8)} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">{pcEnviando ? "Enviando…" : "📤 Enviar contexto"}</button>
            </div>
          </div>
        </Modal>
      )}
      {encaminhar && sel && (
        <Modal title="🔀 Encaminhar para outro número" onClose={() => setEncaminhar(false)} maxWidth="max-w-lg">
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">A conversa entra na fila do número escolhido (em <b>Sem responsável ainda</b>). O histórico que você escolher chega lá <b>como mensagens</b> (com quem mandou e o horário), não como um aviso. Nada é enviado ao cliente — a outra equipe assume e fala pelo número dela.</p>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Para qual número / setor</label>
              <div className="mt-1 grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto">
                {numerosDestino.map(n => (
                  <button key={n.id} type="button" onClick={() => { setEncAlvo(n.id); setEncAtendente(null); }}
                    className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${encAlvo === n.id ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300" : "border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40"}`}>
                    {encAlvo === n.id ? "● " : "○ "}📱 {n.nome}{n.modo === "livre" ? <span className="text-[10px] text-gray-400"> · livre</span> : ""}
                  </button>
                ))}
              </div>
            </div>
            {/* Atribuir direto a um atendente do número de destino (só se ele tiver atendentes fixos e for por atribuição) */}
            {encAtendentes.length > 0 && (
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Atribuir a (opcional)</label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setEncAtendente(null)}
                    className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${!encAtendente ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300" : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/40"}`}>
                    🟡 Deixar na fila
                  </button>
                  {encAtendentes.map(p => (
                    <button key={p.id} type="button" onClick={() => setEncAtendente(p.id)}
                      className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${encAtendente === p.id ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300" : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/40"}`}>
                      {encAtendente === p.id ? "● " : ""}{p.nome}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Seleção de mensagens: escolhe a partir de qual mensagem encaminhar (dela pra frente). */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">A partir de qual mensagem encaminhar</label>
                <span className="text-[11px] text-gray-400">{encIncluidas.length} de {encMsgsSelecionaveis.length}</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5 mb-1.5">Toque na bolinha: tudo daquela mensagem <b>pra baixo</b> vai como mensagens pro próximo atendente.</p>
              {encMsgsSelecionaveis.length === 0 ? (
                <div className="text-xs text-gray-400 italic px-1 py-3">Sem mensagens no histórico pra encaminhar — só o resumo abaixo será enviado.</div>
              ) : (
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40 p-1.5 max-h-56 overflow-y-auto space-y-0.5">
                  {encMsgsSelecionaveis.map((m, i) => {
                    const incl = i >= encIdx;
                    const inicio = i === encIdx;
                    const autor = m.direcao === "in" ? (nomeSel || "Cliente") : (m.autorNome || "Atendente");
                    return (
                      <div key={m.id}>
                        {inicio && <div className="flex items-center gap-1.5 px-1 py-0.5"><span className="flex-1 h-px bg-emerald-300 dark:bg-emerald-800" /><span className="text-[9px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">encaminha daqui</span><span className="flex-1 h-px bg-emerald-300 dark:bg-emerald-800" /></div>}
                        <button type="button" onClick={() => setEncDesdeId(m.id)}
                          className={`w-full flex items-start gap-2 text-left rounded-md px-1.5 py-1 transition-colors ${incl ? "" : "opacity-55"} ${inicio ? "bg-emerald-50 dark:bg-emerald-900/20" : "hover:bg-white dark:hover:bg-gray-800/60"}`}
                          style={incl ? { borderLeft: "2px solid #10b981" } : { borderLeft: "2px solid transparent" }}>
                          <span className={`mt-0.5 w-3.5 h-3.5 rounded-full shrink-0 border flex items-center justify-center ${inicio ? "border-emerald-500 bg-emerald-500" : incl ? "border-emerald-400" : "border-gray-300 dark:border-gray-600"}`}>{inicio && <span className="w-1.5 h-1.5 rounded-full bg-white" />}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className={`text-[11px] font-semibold ${m.direcao === "in" ? "text-gray-600 dark:text-gray-300" : "text-emerald-700 dark:text-emerald-300"}`}>{autor}</span>
                              <span className="text-[10px] text-gray-400">{hhmm(m.timestamp)}</span>
                              {!incl && <span className="text-[9px] text-gray-400 uppercase">fora</span>}
                            </span>
                            <span className="block text-xs text-gray-700 dark:text-gray-200 truncate">{textoMostra(m)}</span>
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {/* Resumo IA — opcional, vai no topo do repasse. */}
            <div>
              <label className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input type="checkbox" checked={encIncluirResumo} onChange={e => setEncIncluirResumo(e.target.checked)} />
                  Incluir resumo da IA no topo
                </span>
                <button type="button" onClick={() => { setEncCarregando(true); void gerarResumo().then(s => setEncResumo(s)).finally(() => setEncCarregando(false)); }} disabled={encCarregando} className="text-[11px] text-indigo-600 dark:text-indigo-300 hover:underline disabled:opacity-50">{encCarregando ? "gerando…" : "↻ Regenerar"}</button>
              </label>
              {encIncluirResumo && <textarea value={encResumo} onChange={e => setEncResumo(e.target.value)} rows={4} placeholder={encCarregando ? "Gerando resumo…" : "Resumo do atendimento…"} className="w-full mt-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm outline-none resize-none" />}
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Observação (opcional)</label>
              <input value={encObs} onChange={e => setEncObs(e.target.value)} placeholder="Ex.: cliente prefere ser chamado à tarde." className="w-full mt-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm outline-none" />
            </div>
            <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input type="checkbox" checked={encFinalizar} onChange={e => setEncFinalizar(e.target.checked)} />
                Finalizar esta conversa (o repasse foi feito)
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input type="checkbox" checked={encAvisar} onChange={e => setEncAvisar(e.target.checked)} />
                Avisar o cliente que foi encaminhado
              </label>
              {encAvisar && <textarea value={encMsgCliente} onChange={e => setEncMsgCliente(e.target.value)} rows={2} placeholder="Mensagem enviada ao cliente…" className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm outline-none resize-none" />}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setEncaminhar(false)} className="px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300">Cancelar</button>
              <button type="button" onClick={() => void enviarEncaminhar()} disabled={encEnviando || !encAlvo} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">{encEnviando ? "Encaminhando…" : "🔀 Encaminhar"}</button>
            </div>
          </div>
        </Modal>
      )}
      {transferir && (transferWaId || sel) && <TransferModal
        pessoas={pessoas.filter(p => { const n = numeros.find(x => x.id === numeroSel); const uids = n?.usuariosIds || []; return uids.length === 0 || uids.includes(p.id); })}
        modo={donoDe(transferWaId || sel || "") ? "transferir" : "atribuir"}
        meId={me?.id || null} onClose={() => { setTransferir(false); setTransferWaId(null); }} onTransferir={transferirPara} />}
      {editarNum && sel && !ehGrupoWaId(sel) && <EditarContatoModal
        nomeAtual={contatoSel?.nomeManual || contatoSel?.nomePush || ""}
        numeroAtual={contatoSel?.telefoneManual ? foneBonito(contatoSel.telefoneManual) : (ehTelefoneBR(sel) ? foneBonito(sel) : "")}
        onFechar={() => setEditarNum(false)}
        onSalvar={async (nome, telDigits) => { await salvarContato(sel, { nomeManual: nome || null, telefoneManual: telDigits || null }); }} />}
      {qrRecon && <QrModal instancia={qrRecon.instancia} nome={qrRecon.nome} qrInicial={null}
        onClose={() => { setQrRecon(null); if (numeroSel) void chamarInstancia("status", numeroSel).then(r => setStatusConexao(r.estado || "unknown")).catch(() => {}); }} />}

      {triagemGrupo && (() => {
        const elegiveis = pessoas.filter(p => { const n = numeros.find(x => x.id === numeroSel); const uids = n?.usuariosIds || []; return uids.length === 0 || uids.includes(p.id); }).sort((a, b) => a.nome.localeCompare(b.nome));
        const disponiveis = elegiveis.filter(p => !triagemIds.includes(p.id));
        const g = triagemGrupo;
        return (
          <div className="fixed inset-0 bg-black/50 z-[210] flex items-center justify-center p-4" onClick={() => setTriagemGrupo(null)}>
            <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md p-5">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">👥 Quem atende esse grupo?</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 mb-3 truncate">{nomeConversa(g)}</p>
              <p className="text-[12px] text-gray-500 dark:text-gray-400 mb-2">Escolha <b>1 ou mais</b> atendentes — o grupo aparece em "Minhas" de cada um. Todo grupo precisa de atendente (ou marque como spam).</p>
              <div className="flex flex-wrap gap-1.5 items-center mb-3">
                {triagemIds.map(id => {
                  const nome = pessoas.find(p => p.id === id)?.nome || "?";
                  return (
                    <span key={id} className="inline-flex items-center gap-1.5 text-[13px] pl-2.5 pr-1 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                      {nome}
                      <button type="button" onClick={() => setTriagemIds(ids => ids.filter(x => x !== id))} className="opacity-60 hover:opacity-100 text-sm leading-none">×</button>
                    </span>
                  );
                })}
                {triagemIds.length === 0 && <span className="text-[12px] text-gray-400 italic">nenhum atendente ainda</span>}
              </div>
              <select value="" onChange={(e) => { if (e.target.value) setTriagemIds(ids => [...ids, e.target.value]); }}
                className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-2 text-gray-700 dark:text-gray-200">
                <option value="">＋ Adicionar atendente…</option>
                {disponiveis.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
              <div className="flex items-center gap-2 mt-5">
                <button type="button" onClick={() => void marcarGrupoSpam(g)} className="text-sm px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-700 text-rose-600 dark:text-rose-300">🚫 É spam</button>
                <div className="flex-1" />
                <button type="button" onClick={() => setTriagemGrupo(null)} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300">Cancelar</button>
                <button type="button" onClick={() => void salvarTriagem(g)} disabled={!triagemIds.length} className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-50">✓ Confirmar</button>
              </div>
            </div>
          </div>
        );
      })()}
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
      {/* Ações reveladas atrás (à esquerda). Só pintam quando a linha está sendo
          arrastada/aberta — senão vazam por baixo do fundo translúcido da linha
          não lida no dark mode. */}
      <div className={`absolute inset-y-0 left-0 flex ${dx > 0 || aberto ? "" : "invisible"}`} style={{ width: MAX }}>
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
        className={`relative w-full text-left flex items-center gap-3 px-4 py-3 ${naoLida ? "bg-rose-50 dark:bg-rose-950" : "bg-white dark:bg-gray-900"}`}>
        {children}
      </button>
    </div>
  );
}

// Criar um GRUPO de WhatsApp: nome + participantes (por pessoa cadastrada ou
// número digitado). Precisa do telefone de cada participante.
function NovoGrupoModal({ pessoas, onCriar, onClose }: { pessoas: Pessoa[]; onCriar: (subject: string, participants: string[]) => Promise<boolean>; onClose: () => void }) {
  const [subject, setSubject] = useState("");
  const [busca, setBusca] = useState("");
  const [manual, setManual] = useState("");
  const [membros, setMembros] = useState<{ label: string; fone: string }[]>([]);
  const [criando, setCriando] = useState(false);
  const comFone = pessoas.filter(p => (p.whatsapp || "").replace(/\D/g, "").length >= 10);
  const q = busca.trim().toLowerCase();
  const cand = q ? comFone.filter(p => p.nome.toLowerCase().includes(q) && !membros.some(m => m.fone === (p.whatsapp || "").replace(/\D/g, ""))).slice(0, 6) : [];
  function add(label: string, foneRaw: string) {
    const fone = (foneRaw || "").replace(/\D/g, "");
    if (fone.length < 10 || membros.some(m => m.fone === fone)) return;
    setMembros(v => [...v, { label: label || fone, fone }]); setBusca(""); setManual("");
  }
  async function criar() {
    if (!subject.trim()) { alert("Dê um nome pro grupo."); return; }
    if (!membros.length) { alert("Adicione pelo menos um participante."); return; }
    setCriando(true);
    const ok = await onCriar(subject.trim(), membros.map(m => m.fone));
    setCriando(false);
    if (ok) onClose();
  }
  const inp = "w-full text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 dark:text-gray-100";
  return (
    <Modal onClose={onClose} title="👥 Novo grupo" maxWidth="max-w-md">
      <div className="space-y-3">
        <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Nome do grupo" className={inp} autoFocus />
        <div>
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">Participantes</div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {membros.map(m => (
              <span key={m.fone} className="inline-flex items-center gap-1.5 text-[13px] pl-2.5 pr-1 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                {m.label}
                <button type="button" onClick={() => setMembros(v => v.filter(x => x.fone !== m.fone))} className="opacity-60 hover:opacity-100 text-sm leading-none">×</button>
              </span>
            ))}
            {membros.length === 0 && <span className="text-[12px] text-gray-400 italic">nenhum participante ainda</span>}
          </div>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔍 Buscar pessoa cadastrada…" className={inp} />
          {cand.length > 0 && (
            <div className="mt-1 rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
              {cand.map(p => (
                <button key={p.id} type="button" onClick={() => add(p.nome, p.whatsapp || "")} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  {p.nome} <span className="text-gray-400 text-xs">· {p.whatsapp}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2 mt-2">
            <input value={manual} onChange={e => setManual(e.target.value)} placeholder="ou digite o número (DDD + número)" className={`${inp} flex-1`} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(manual, manual); } }} />
            <Button variant="secondary" onClick={() => add(manual, manual)} disabled={manual.replace(/\D/g, "").length < 10}>Adicionar</Button>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose} disabled={criando}>Cancelar</Button>
          <Button onClick={() => void criar()} disabled={criando}>{criando ? "Criando…" : "👥 Criar grupo"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// Editar contato: corrige nome e/ou número (ex.: número capturado errado, ou
// estrangeiro que caiu como BR). O número corrigido passa a ser o alvo do envio.
function EditarContatoModal({ nomeAtual, numeroAtual, onSalvar, onFechar }: {
  nomeAtual: string; numeroAtual: string;
  onSalvar: (nome: string, telefoneDigits: string) => Promise<void>; onFechar: () => void;
}) {
  const [nome, setNome] = useState(nomeAtual);
  const [num, setNum] = useState(numeroAtual);
  const [salvando, setSalvando] = useState(false);
  const digits = digitosEnviaveis(num);
  const previa = digits ? foneBonito(digits) : "";
  return (
    <div className="fixed inset-0 z-[220] bg-black/40 flex items-center justify-center p-4" onClick={onFechar}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-semibold text-gray-900 dark:text-gray-100">Editar contato</div>
        <label className="block">
          <span className="text-[12px] text-gray-500 dark:text-gray-400">Nome</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do contato"
            className="mt-0.5 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm dark:text-gray-100" />
        </label>
        <label className="block">
          <span className="text-[12px] text-gray-500 dark:text-gray-400">Número</span>
          <input value={num} onChange={(e) => setNum(e.target.value)} inputMode="tel" placeholder="+61 475 505 537  ·  91 98888-7777"
            className="mt-0.5 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm dark:text-gray-100" />
          {previa ? <span className="text-[11px] text-emerald-600 dark:text-emerald-400">Vai enviar para: {previa}</span>
            : num.trim() ? <span className="text-[11px] text-amber-600 dark:text-amber-400">Número incompleto.</span> : null}
        </label>
        <p className="text-[11px] text-gray-400">Use quando o número veio errado. Para número <b>de fora do Brasil</b>, comece com <b>+DDI</b> (ex.: <b>+61</b> Austrália, <b>+351</b> Portugal). Sem o "+", assumimos Brasil.</p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onFechar} className="px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">Cancelar</button>
          <button type="button" disabled={salvando} onClick={async () => { setSalvando(true); try { await onSalvar(nome.trim(), digits); onFechar(); } catch { setSalvando(false); } }}
            className="px-3 py-2 rounded-lg text-sm bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">{salvando ? "Salvando…" : "Salvar"}</button>
        </div>
      </div>
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
  // "unknown" = a checagem de status NÃO respondeu (ex.: Evolution/rede fora).
  // Mostra âmbar "Sem resposta" em vez de mentir "Conectado" com dado velho.
  unknown: { label: "⚠ Sem resposta", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
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

  // Roteios: mapa (restaurante × papel) → número. Doc /whatsappRoteios/{rid}.
  const [roteios, setRoteios] = useState<Record<string, WhatsappRoteio>>({});
  useEffect(() => {
    const u = onSnapshot(collection(db, "whatsappRoteios"), snap => setRoteios(Object.fromEntries(snap.docs.map(d => [d.id, d.data() as WhatsappRoteio]))));
    return () => u();
  }, []);
  async function setPapel(rid: string, papel: PapelWhatsapp, numeroId: string) {
    await setDoc(doc(db, "whatsappRoteios", rid), { [papel]: numeroId || null, atualizadoEm: new Date().toISOString() }, { merge: true });
  }
  const restaurantesGerir = me?.isMaster ? restaurants : restaurants.filter(r => (r.id));

  const [nome, setNome] = useState("");
  const [instancia, setInstancia] = useState("");
  const [descricao, setDescricao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [qr, setQr] = useState<{ instancia: string; nome: string; qr: string | null } | null>(null);
  const [estados, setEstados] = useState<Record<string, string>>({});
  const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  // Poll do status de conexão de cada número. Se a checagem de um número FALHAR
  // (Evolution/rede fora), esse número vira "unknown" — nunca congela no último
  // "Conectado" (era o bug: caía tudo e o selo continuava verde).
  async function atualizarStatus() {
    const res = await Promise.all(numeros.map(async n => {
      try { return [n.id, (await chamarInstancia("status", n.id)).estado || "unknown"] as const; }
      catch { return [n.id, "unknown"] as const; }
    }));
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

        {/* Números por papel — qual número atende cada tipo em cada restaurante.
            É isso que o botão "Falar pelo WhatsApp" dos módulos usa. */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Números por papel</div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">Qual número o "Falar pelo WhatsApp" usa pra cada tipo de contato, por restaurante.</p>
          <div className="space-y-4">
            {restaurantesGerir.map(r => {
              const disp = numeros.filter(n => (n.ativo !== false) && ((n.restaurantIds || []).length === 0 || (n.restaurantIds || []).includes(r.id)));
              const rot = roteios[r.id] || {};
              return (
                <div key={r.id}>
                  <div className="text-[13px] font-semibold text-gray-800 dark:text-gray-100 mb-1.5">{r.nome}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {PAPEIS_WHATSAPP.map(p => (
                      <label key={p.id} className="flex items-center gap-2 text-[13px]">
                        <span className="w-40 shrink-0 text-gray-600 dark:text-gray-300 truncate" title={p.desc}>{p.icon} {p.label}</span>
                        <select value={rot[p.id] || ""} onChange={(e) => void setPapel(r.id, p.id, e.target.value)}
                          className="flex-1 min-w-0 text-[13px] rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5">
                          <option value="">— sem número —</option>
                          {disp.map(n => <option key={n.id} value={n.id}>{n.nome}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
            {restaurantesGerir.length === 0 && <p className="text-sm text-gray-400">Nenhum restaurante.</p>}
          </div>
        </div>

        {/* Lista de números */}
        <div className="space-y-2.5">
          {numeros.length === 0 && <div className="text-center text-sm text-gray-400 py-4">Nenhum número ainda.</div>}
          {numeros.map(n => (
            <NumeroConfigCard key={n.id} numero={n} estado={estados[n.id] || "unknown"} pessoas={pessoas} restaurants={restaurants}
              onQr={() => setQr({ instancia: n.id, nome: n.nome, qr: null })}
              onLogout={async () => { if (!confirm(`Desconectar "${n.nome}"? O número sai do ar até reconectar.`)) return; await chamarInstancia("logout", n.id); void atualizarStatus(); }}
              onRecriar={async () => {
                if (!confirm(`Recriar a sessão de "${n.nome}" na Evolution?\n\nApaga SÓ a sessão corrompida do WhatsApp e recria a instância com o mesmo nome. MANTÉM toda a config (nome, usuários, empresas, IA, tags) e o histórico de conversas. Você vai escanear o QR de novo.`)) return;
                const r = await chamarInstancia("recreate", n.id);
                if (r.error) { alert("Falha ao recriar: " + r.error); return; }
                setQr({ instancia: n.id, nome: n.nome, qr: r.qr || null });
              }}
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

function NumeroConfigCard({ numero, estado, pessoas, restaurants, onQr, onLogout, onRecriar, onExcluir }: {
  numero: WhatsappNumero; estado: string; pessoas: Pessoa[]; restaurants: { id: string; nome: string }[];
  onQr: () => void; onLogout: () => void; onRecriar: () => void; onExcluir: () => void;
}) {
  const { pessoa: me } = useAuth();
  const isMaster = !!me?.isMaster;
  const [aberto, setAberto] = useState(false);
  const [buscaU, setBuscaU] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [reparando, setReparando] = useState(false);
  const [testResult, setTestResult] = useState<string>("");
  // Diagnóstico: dispara um envio de teste e mostra a RESPOSTA CRUA da Evolution
  // (HTTP + corpo), pra descobrir por que "não envia".
  async function testarEnvio() {
    const num = prompt("Diagnóstico de envio — número de teste (com DDD, ex.: 91999999999):");
    if (!num) return;
    setTestResult("Enviando teste…");
    try {
      const r = await fetch("/api/evolution-enviar", {
        method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ instancia: numero.id, to: soDig(num), texto: "🩺 Teste de envio (diagnóstico planejamento.app)" }),
      });
      const j = await r.json().catch(() => ({}));
      setTestResult(`HTTP ${r.status}\n${JSON.stringify(j, null, 2)}`);
    } catch (e) { setTestResult("Falha na chamada: " + (e instanceof Error ? e.message : "?")); }
  }
  // Conserta o caso "aparece Conectado mas não envia/recebe": reinicia o socket
  // na Evolution (sem novo QR) e re-aponta o webhook.
  async function repararConexao() {
    setReparando(true);
    try {
      const r = await chamarInstancia("restart", numero.id);
      if (r.error) { alert("Falha ao reparar: " + r.error); return; }
      alert(`Conexão reiniciada e webhook reapontado. Estado: ${r.estado || "?"}.\nMande uma mensagem de teste; se ainda não fluir, use Desconectar e reconecte com QR.`);
    } catch (e) { alert("Falha ao reparar: " + (e instanceof Error ? e.message : "?")); }
    finally { setReparando(false); }
  }
  const [draft, setDraft] = useState(() => ({ nome: numero.nome, descricao: numero.descricao || "", restaurantIds: numero.restaurantIds || [], usuariosIds: numero.usuariosIds || [], apelidos: numero.apelidos || {}, regras: numero.regras || "", modo: numero.modo || "atribuicao", ativo: numero.ativo !== false }));
  // Ressincroniza o rascunho quando o doc muda (ex.: depois de salvar).
  useEffect(() => { setDraft({ nome: numero.nome, descricao: numero.descricao || "", restaurantIds: numero.restaurantIds || [], usuariosIds: numero.usuariosIds || [], apelidos: numero.apelidos || {}, regras: numero.regras || "", modo: numero.modo || "atribuicao", ativo: numero.ativo !== false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numero.id, numero.nome, numero.descricao, (numero.restaurantIds || []).join(","), (numero.usuariosIds || []).join(","), JSON.stringify(numero.apelidos || {}), numero.regras, numero.modo, numero.ativo]);

  const eqArr = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
  const dirty = draft.nome !== numero.nome || draft.descricao !== (numero.descricao || "") || !eqArr(draft.restaurantIds, numero.restaurantIds || []) || !eqArr(draft.usuariosIds, numero.usuariosIds || []) || JSON.stringify(draft.apelidos) !== JSON.stringify(numero.apelidos || {}) || draft.regras !== (numero.regras || "") || draft.modo !== (numero.modo || "atribuicao") || draft.ativo !== (numero.ativo !== false);

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

  async function salvar() { setSalvando(true); try {
    // Só guarda apelidos de quem tem acesso e com valor preenchido.
    const apelidosLimpo: { [id: string]: string } = {};
    for (const uid of draft.usuariosIds) { const a = (draft.apelidos[uid] || "").trim(); if (a) apelidosLimpo[uid] = a; }
    await setDoc(doc(db, "whatsappNumeros", numero.id), sanitizeForFirestore({ nome: draft.nome.trim() || numero.nome, descricao: draft.descricao.trim() || null, restaurantIds: draft.restaurantIds, usuariosIds: draft.usuariosIds, apelidos: apelidosLimpo, regras: draft.regras.trim() || null, modo: draft.modo, ativo: draft.ativo, atualizadoEm: new Date().toISOString() }), { merge: true }); } catch (e) { alert("Erro ao salvar: " + (e instanceof Error ? e.message : "?")); } finally { setSalvando(false); } }
  const cancelar = () => setDraft({ nome: numero.nome, descricao: numero.descricao || "", restaurantIds: numero.restaurantIds || [], usuariosIds: numero.usuariosIds || [], apelidos: numero.apelidos || {}, regras: numero.regras || "", modo: numero.modo || "atribuicao", ativo: numero.ativo !== false });

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
                ? <>
                    <button type="button" onClick={repararConexao} disabled={reparando}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 disabled:opacity-50">
                      {reparando ? "🔧 Reparando…" : "🔧 Reparar (não envia/recebe?)"}
                    </button>
                    <button type="button" onClick={testarEnvio} className="text-xs px-2.5 py-1.5 rounded-lg border border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300">🩺 Testar envio</button>
                    <button type="button" onClick={onLogout} className="text-xs px-2.5 py-1.5 rounded-lg border border-rose-300 dark:border-rose-700 text-rose-600 dark:text-rose-300">⏻ Desconectar</button>
                  </>
                : <button type="button" onClick={onQr} className="text-xs px-2.5 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-300">{estado === "close" ? "🔄 Reconectar" : "🔌 Conectar"}</button>}
              {isMaster && (
                <button type="button" onClick={onRecriar} className="text-xs px-2.5 py-1.5 rounded-lg border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300">♻️ Recriar sessão (master)</button>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">Aparece Conectado mas as mensagens não entram/saem? Clique em <b>Reparar</b> — reinicia a conexão (sem novo QR) e reaponta o webhook. Se o envio falha, use <b>Testar envio</b>.</p>
            {isMaster && <p className="text-[11px] text-purple-500 dark:text-purple-400 mt-1">♻️ <b>Recriar sessão</b>: quando reconectar por QR não resolve (ex.: envia em grupo mas 1:1 dá ❌). Apaga só a sessão corrompida na Evolution e recria a instância — <b>mantém</b> nome, usuários, empresas, IA, tags e o histórico. Você reescaneia o QR.</p>}
            {testResult && (
              <pre className="mt-2 text-[10.5px] leading-snug whitespace-pre-wrap break-words bg-gray-900 text-emerald-200 rounded-lg p-2.5 max-h-52 overflow-auto select-all">{testResult}</pre>
            )}
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
              <div className="space-y-1.5 mt-1 mb-1.5">
                {selecionados.length === 0 && <span className="text-[11px] text-gray-400">Ninguém ainda.</span>}
                {selecionados.map(p => (
                  <div key={p.id} className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shrink-0 max-w-[45%] truncate">
                      {p.nome}
                      <button type="button" onClick={() => setDraft(d => { const ap = { ...d.apelidos }; delete ap[p.id]; return { ...d, usuariosIds: d.usuariosIds.filter(x => x !== p.id), apelidos: ap }; })} className="opacity-70 hover:opacity-100">✕</button>
                    </span>
                    <input value={draft.apelidos[p.id] || ""} onChange={e => setDraft(d => ({ ...d, apelidos: { ...d.apelidos, [p.id]: e.target.value } }))} placeholder={`apelido (vazio → “${p.nome.split(" ")[0]}”)`} className="flex-1 min-w-0 px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mb-1">O apelido troca só o nome que o <b>cliente</b> vê no início da mensagem (ex.: <i>*Gu:*</i>). Vazio = primeiro nome real.</p>
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
          <SecaoCfg icon="🎛️" titulo="Modo de atendimento">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {([
                ["atribuicao", "Com atribuição", "Conversas têm dono. Tela Início (Sem responsável | Minhas), assumir, transferir. Bom pro escritório."],
                ["livre", "Livre — quem vê responde", "Sem dono e sem assumir. Lista única, não-lidas no topo. Bom pra operação."],
              ] as const).map(([v, titulo, desc]) => {
                const ativo = draft.modo === v;
                return (
                  <button key={v} type="button" onClick={() => setDraft(d => ({ ...d, modo: v }))}
                    className={`text-left p-3 rounded-xl border transition-colors ${ativo ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20" : "border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40"}`}>
                    <div className={`text-sm font-semibold ${ativo ? "text-emerald-700 dark:text-emerald-300" : "text-gray-800 dark:text-gray-200"}`}>{ativo ? "● " : "○ "}{titulo}</div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{desc}</div>
                  </button>
                );
              })}
            </div>
          </SecaoCfg>

          <SecaoCfg icon="📋" titulo="Regras de uso" hint="opcional">
            <textarea value={draft.regras} onChange={e => setDraft(d => ({ ...d, regras: e.target.value }))} rows={2} className={inp} placeholder="Ex.: só responder em horário comercial; confirmar preço antes de fechar…" />
          </SecaoCfg>

          {/* Respostas rápidas deste número */}
          <SecaoCfg>
            <RespostasNumero numeroId={numero.id} />
          </SecaoCfg>

          {/* Triagem automática por área (bot) */}
          <SecaoCfg icon="🤖" titulo="Triagem automática" hint="menu de áreas">
            <RoteamentoNumero numero={numero} pessoas={pessoas} />
          </SecaoCfg>

          {/* Assistente de IA (concierge) */}
          <SecaoCfg icon="✨" titulo="Assistente de IA" hint="responde e confirma reservas">
            <AssistenteIaNumero numero={numero} restaurants={restaurants} />
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

// Config do menu automático de triagem por área (roda no webhook).
function RoteamentoNumero({ numero, pessoas }: { numero: WhatsappNumero; pessoas: Pessoa[] }) {
  const vazio: WhatsappRoteamento = { ativo: false, saudacao: "", mensagemRoteado: "", opcoes: [] };
  const [rot, setRot] = useState<WhatsappRoteamento>(() => numero.roteamento || vazio);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setRot(numero.roteamento || vazio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numero.id, JSON.stringify(numero.roteamento)]);
  const elegiveis = pessoas.filter(p => { const uids = numero.usuariosIds || []; return uids.length === 0 || uids.includes(p.id); }).sort((a, b) => a.nome.localeCompare(b.nome));
  const inp = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
  const opcoes = rot.opcoes || [];
  const setOpc = (i: number, patch: Partial<NonNullable<WhatsappRoteamento["opcoes"]>[number]>) => setRot(r => ({ ...r, opcoes: (r.opcoes || []).map((o, idx) => idx === i ? { ...o, ...patch } : o) }));
  const addOpc = () => setRot(r => ({ ...r, opcoes: [...(r.opcoes || []), { id: "op_" + Math.random().toString(36).slice(2, 8), rotulo: "", pessoaId: "" }] }));
  const delOpc = (i: number) => setRot(r => ({ ...r, opcoes: (r.opcoes || []).filter((_, idx) => idx !== i) }));
  const dirty = JSON.stringify(rot) !== JSON.stringify(numero.roteamento || vazio);
  async function salvar() {
    setSalvando(true);
    try {
      const limpa: WhatsappRoteamento = { ativo: !!rot.ativo, saudacao: rot.saudacao?.trim() || "", mensagemRoteado: rot.mensagemRoteado?.trim() || "",
        opcoes: opcoes.filter(o => o.rotulo?.trim() && o.pessoaId).map(o => ({ id: o.id, rotulo: o.rotulo.trim(), pessoaId: o.pessoaId, pessoaNome: elegiveis.find(p => p.id === o.pessoaId)?.nome || o.pessoaNome || undefined, atalhos: o.atalhos })) };
      await setDoc(doc(db, "whatsappNumeros", numero.id), sanitizeForFirestore({ roteamento: limpa }), { merge: true });
    } catch (e) { alert("Erro ao salvar: " + (e instanceof Error ? e.message : "?")); } finally { setSalvando(false); }
  }
  return (
    <div className="space-y-2.5">
      <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
        <input type="checkbox" checked={!!rot.ativo} onChange={e => setRot(r => ({ ...r, ativo: e.target.checked }))} /> Ativar menu automático
      </label>
      <p className="text-[11px] text-gray-400">Cliente novo manda mensagem → o sistema responde com o menu; ao escolher, a conversa é atribuída ao atendente da área. Para assim que alguém assume.</p>
      <div>
        <label className="text-[11px] text-gray-500">Saudação + instrução</label>
        <textarea value={rot.saudacao || ""} onChange={e => setRot(r => ({ ...r, saudacao: e.target.value }))} rows={2} className={inp} placeholder="Ex.: Olá! Com qual área você quer falar?" />
      </div>
      <div>
        <div className="text-[11px] text-gray-500 mb-1">Áreas (opções do menu)</div>
        <div className="space-y-1.5">
          {opcoes.length === 0 && <div className="text-xs text-gray-400">Nenhuma área ainda.</div>}
          {opcoes.map((o, i) => (
            <div key={o.id} className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400 w-4 shrink-0">{i + 1}.</span>
              <input value={o.rotulo} onChange={e => setOpc(i, { rotulo: e.target.value })} className={`${inp} flex-1`} placeholder="Área (ex.: Financeiro)" />
              <select value={o.pessoaId} onChange={e => setOpc(i, { pessoaId: e.target.value })} className={`${inp} flex-1`}>
                <option value="">— atendente —</option>
                {elegiveis.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
              <button type="button" onClick={() => delOpc(i)} className="text-gray-400 hover:text-rose-600 text-sm shrink-0">🗑️</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addOpc} className="mt-1.5 w-full text-xs font-semibold px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50">➕ Adicionar área</button>
      </div>
      <div>
        <label className="text-[11px] text-gray-500">Confirmação após escolher (use <code>{"{atendente}"}</code>)</label>
        <input value={rot.mensagemRoteado || ""} onChange={e => setRot(r => ({ ...r, mensagemRoteado: e.target.value }))} className={inp} placeholder="Ex.: Perfeito! Vou te encaminhar para {atendente}. 😊" />
      </div>
      <div className="flex items-center justify-end gap-2">
        {dirty && <span className="text-[11px] text-amber-600 dark:text-amber-400 mr-auto">Alterações não salvas</span>}
        <Button size="sm" onClick={() => void salvar()} disabled={!dirty || salvando}>{salvando ? "Salvando…" : "💾 Salvar triagem"}</Button>
      </div>
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
