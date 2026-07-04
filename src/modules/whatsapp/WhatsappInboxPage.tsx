// Caixa de entrada do WhatsApp da plataforma. Mostra as conversas recebidas
// (whatsappMensagens, gravadas pelo webhook) e permite responder — texto livre
// funciona dentro da janela de 24h da última mensagem da pessoa; fora disso a
// Meta exige template. Número é único da plataforma (não por restaurante).
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { addDoc, collection, doc, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { enviarWhatsapp } from "../../core/whatsapp/enviar";

type Msg = { id: string; waId: string; nome?: string | null; direcao: "in" | "out"; tipo?: string; texto?: string; timestamp?: string; recebidoEm?: string; lido?: boolean; autorNome?: string | null };
const hhmm = (iso?: string) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
const foneBonito = (wa: string) => { const d = (wa || "").replace(/\D/g, ""); const n = d.startsWith("55") ? d.slice(2) : d; return n.length >= 10 ? `+55 ${n.slice(0, 2)} ${n.slice(2, n.length - 4)}-${n.slice(-4)}` : wa; };

export function WhatsappInboxPage() {
  const { pessoa: me } = useAuth();
  const { rid } = useParams<{ rid: string }>();
  const isMaster = !!me?.isMaster;
  const { can } = useCanAcao(rid || "");
  const podeVer = isMaster || can("whatsappInbox", "ver");
  const podeResponder = isMaster || can("whatsappInbox", "responder");

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [resposta, setResposta] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const u = onSnapshot(query(collection(db, "whatsappMensagens"), orderBy("timestamp", "asc")), snap =>
      setMsgs(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Msg)));
    return () => u();
  }, []);

  // Agrupa por número (conversa). Última msg define a ordem.
  const conversas = useMemo(() => {
    const m = new Map<string, { waId: string; nome?: string | null; ultima: Msg; naoLidas: number }>();
    for (const msg of msgs) {
      const c = m.get(msg.waId) || { waId: msg.waId, nome: msg.nome, ultima: msg, naoLidas: 0 };
      c.ultima = msg; if (msg.nome) c.nome = msg.nome;
      m.set(msg.waId, c);
    }
    for (const msg of msgs) if (msg.direcao === "in" && !msg.lido) { const c = m.get(msg.waId); if (c) c.naoLidas++; }
    return [...m.values()].sort((a, b) => (b.ultima.timestamp || "").localeCompare(a.ultima.timestamp || ""));
  }, [msgs]);

  const thread = useMemo(() => msgs.filter(x => x.waId === sel), [msgs, sel]);
  const nomeSel = conversas.find(c => c.waId === sel)?.nome;
  // Janela de 24h: última mensagem RECEBIDA da pessoa.
  const ultimaEntrada = useMemo(() => thread.filter(m => m.direcao === "in").slice(-1)[0], [thread]);
  const dentro24h = ultimaEntrada?.timestamp ? (Date.now() - new Date(ultimaEntrada.timestamp).getTime()) < 24 * 3600 * 1000 : false;

  // Ao abrir a conversa, marca as recebidas como lidas.
  useEffect(() => {
    if (!sel) return;
    for (const m of msgs) if (m.waId === sel && m.direcao === "in" && !m.lido) void updateDoc(doc(db, "whatsappMensagens", m.id), { lido: true }).catch(() => {});
  }, [sel, msgs]);

  async function responder() {
    const txt = resposta.trim();
    if (!txt || !sel) return;
    setEnviando(true);
    const r = await enviarWhatsapp({ to: sel, texto: txt, contexto: "inbox_resposta", criadoPor: me?.id });
    if (r.ok) {
      await addDoc(collection(db, "whatsappMensagens"), sanitizeForFirestore({ waId: sel, nome: nomeSel || null, direcao: "out", tipo: "text", texto: txt, timestamp: new Date().toISOString(), recebidoEm: new Date().toISOString(), lido: true, autorNome: me?.nome || null }));
      setResposta("");
    } else {
      alert(r.naoConfigurado ? "WhatsApp ainda não configurado (env vars)." : (r.erro || "Falha ao enviar."));
    }
    setEnviando(false);
  }

  if (!podeVer) return <div className="max-w-2xl mx-auto py-12 text-center"><div className="text-4xl mb-3">🔒</div><p className="text-gray-700 dark:text-gray-300 font-medium">Sem acesso à caixa de entrada do WhatsApp.</p></div>;

  return (
    <div className="max-w-4xl">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">💬 WhatsApp</h1>
        <p className="text-xs text-gray-500">Mensagens recebidas no número da plataforma. Número único (não por restaurante).</p>
      </div>

      {!sel ? (
        conversas.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">Nenhuma mensagem recebida ainda. Quando alguém mandar no WhatsApp do planejamento.app, aparece aqui.</div>
        ) : (
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
            {conversas.map(c => (
              <button key={c.waId} type="button" onClick={() => setSel(c.waId)} className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center text-lg shrink-0">💬</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="font-medium text-gray-900 dark:text-gray-100 truncate">{c.nome || foneBonito(c.waId)}</span>{c.naoLidas > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white">{c.naoLidas}</span>}</div>
                  <div className="text-xs text-gray-500 truncate">{c.ultima.direcao === "out" ? "Você: " : ""}{c.ultima.texto || `[${c.ultima.tipo || "msg"}]`}</div>
                </div>
                <span className="text-[10px] text-gray-400 shrink-0">{hhmm(c.ultima.timestamp)}</span>
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col h-[70vh]">
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 dark:border-gray-800">
            <button type="button" onClick={() => setSel(null)} className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">←</button>
            <div className="min-w-0"><div className="font-medium text-gray-900 dark:text-gray-100 truncate">{nomeSel || foneBonito(sel)}</div><div className="text-[11px] text-gray-400">{foneBonito(sel)}</div></div>
          </div>
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
          {podeResponder && (
            <div className="border-t border-gray-200 dark:border-gray-800 p-2">
              {!dentro24h && <div className="text-[11px] text-amber-700 dark:text-amber-400 mb-1 px-1">⚠ Fora da janela de 24h — texto livre pode falhar; nesse caso só template aprovado inicia a conversa.</div>}
              <div className="flex items-end gap-2">
                <textarea value={resposta} onChange={e => setResposta(e.target.value)} rows={1} placeholder="Responder…" className="flex-1 px-3 py-2 text-base rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 resize-none" onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void responder(); } }} />
                <Button onClick={() => void responder()} disabled={enviando || !resposta.trim()}>{enviando ? "…" : "Enviar"}</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
