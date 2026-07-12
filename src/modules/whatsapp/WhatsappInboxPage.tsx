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
  const podeVer = isMaster || can("whatsapp", "ver");
  const podeResponder = isMaster || can("whatsapp", "responder");
  const podeVincular = isMaster || can("whatsapp", "vincular");

  const [numeros, setNumeros] = useState<WhatsappNumero[]>([]);
  const [numeroSel, setNumeroSel] = useState<string | null>(null);
  const [novaConversa, setNovaConversa] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [contatos, setContatos] = useState<Record<string, WhatsappContato>>({});
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
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col h-[72vh]">
          {/* Header da conversa */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 dark:border-gray-800">
            <button type="button" onClick={() => setSel(null)} className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">←</button>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{nomeSel}</div>
              <div className="text-[11px] text-gray-400">{foneBonito(sel)}{pessoaSel && <> · 👤 {pessoaSel.nome}</>}</div>
            </div>
            <button type="button" onClick={() => marcarNaoLida(sel)} title="Marcar como não lida" className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-500 hover:text-rose-600">🔵 Não lida</button>
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

      {novaConversa && <NovaConversaModal pessoas={pessoas} onClose={() => setNovaConversa(false)}
        onAbrir={(waId, pid) => { setNovaConversa(false); setSel(waId); if (pid) void salvarContato(waId, { pessoaId: pid }); }} />}
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
    <div>
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
                  {est === "open"
                    ? <button type="button" onClick={async () => { if (!confirm(`Desconectar "${n.nome}"? O número sai do ar até reconectar.`)) return; await chamarInstancia("logout", n.id); void atualizarStatus(); }} className="text-[11px] px-2 py-1 rounded-lg border border-rose-300 dark:border-rose-700 text-rose-600 dark:text-rose-300">⏻ Desconectar</button>
                    : <button type="button" onClick={() => setQr({ instancia: n.id, nome: n.nome, qr: null })} className="text-[11px] px-2 py-1 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-300">{est === "close" ? "🔄 Reconectar" : "🔌 Conectar"}</button>}
                  <button type="button" onClick={() => setExpandido(aberto ? null : n.id)} className="text-[11px] px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">👥 Usuários</button>
                  <button type="button" onClick={() => void excluir(n)} className="text-gray-400 hover:text-rose-600 text-sm">🗑️</button>
                </div>
                {aberto && (
                  <div className="px-3 pb-3 border-t border-gray-100 dark:border-gray-800 pt-2 space-y-2">
                    <div className="text-[11px] font-semibold text-gray-500 uppercase">Empresa(s) deste número</div>
                    <div className="flex flex-wrap gap-1.5">
                      {restaurants.map(r => {
                        const on = (n.restaurantIds || []).includes(r.id);
                        return (
                          <button key={r.id} type="button" onClick={() => { const cur = n.restaurantIds || []; void patch(n.id, { restaurantIds: on ? cur.filter(x => x !== r.id) : [...cur, r.id] }); }}
                            className={`text-xs font-medium px-3 py-1.5 rounded-full border ${on ? "border-indigo-500 bg-indigo-500 text-white" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800"}`}>{on ? "✓ " : ""}{r.nome}</button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-gray-400">Trava o número numa empresa: só quem é dessa empresa pode usar. Vazio = qualquer empresa.</p>

                    <div className="text-[11px] font-semibold text-gray-500 uppercase pt-1">Quem pode usar este número</div>
                    <input value={buscaU} onChange={e => setBuscaU(e.target.value)} className={inp} placeholder="Buscar pessoa…" />
                    <div className="max-h-44 overflow-y-auto flex flex-wrap gap-x-4 gap-y-1">
                      {pessoasFiltradas(buscaU).filter(p => { const rs = n.restaurantIds || []; return rs.length === 0 || (p.restaurantIds || []).some(r => rs.includes(r)); }).map(p => (
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
      {qr && <QrModal instancia={qr.instancia} nome={qr.nome} qrInicial={qr.qr} onClose={() => { setQr(null); void atualizarStatus(); }} />}
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
