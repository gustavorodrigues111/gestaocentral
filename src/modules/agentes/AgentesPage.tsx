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
  const [aba, setAba] = useState<"agentes" | "config" | "historico">("agentes");
  const [configSel, setConfigSel] = useState<string | null>(null);
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
    for (const tipo of ["dp", "financeiro", "vendas", "cardapio", "cardapio_site"] as AgenteDominio[]) {
      if (agentes.some(a => a.tipo === tipo)) continue;
      const m = DOMINIO_META[tipo];
      await setDoc(doc(db, "agentesIA", uid()), sanitizeForFirestore({ nome: `Agente ${m.label}`, tipo, systemPrompt: m.promptPadrao, tools: toolsPadrao(tipo), entidades: "todas", modoEscrita: "confirmar", ativo: true, criadoEm: agora, criadoPor: pessoa?.id || null } as Omit<AgenteIA, "id">));
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      {conversando ? (
        <AgenteChat agente={conversando} pessoaId={pessoa?.id} pessoaNome={pessoa?.nome} onVoltar={() => setConversando(null)} onConfig={() => { setEditando(conversando); setConversando(null); }} />
      ) : (<>
      <div className="flex items-center gap-2 mb-3">
        <button type="button" onClick={() => setAba("agentes")} className={`text-sm font-medium pb-1.5 border-b-2 ${aba === "agentes" ? "border-indigo-600 text-indigo-600 dark:text-indigo-300" : "border-transparent text-gray-500"}`}>Agentes</button>
        <button type="button" onClick={() => { setAba("config"); setConfigSel(s => s || agentes[0]?.id || null); }} className={`text-sm font-medium pb-1.5 border-b-2 ${aba === "config" ? "border-indigo-600 text-indigo-600 dark:text-indigo-300" : "border-transparent text-gray-500"}`}>Configurações</button>
        <button type="button" onClick={() => setAba("historico")} className={`text-sm font-medium pb-1.5 border-b-2 ${aba === "historico" ? "border-indigo-600 text-indigo-600 dark:text-indigo-300" : "border-transparent text-gray-500"}`}>Histórico</button>
      </div>

      {aba === "agentes" ? (
        <>
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <p className="text-xs text-gray-500 max-w-lg">Agentes consultam dados da plataforma e — com <b>confirmação</b> — alteram. O acesso de cada um herda as permissões de quem fala com ele. O chat e a resposta no WhatsApp chegam no próximo passo.</p>
            <div className="flex gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => novo("dp")}>🧑‍💼 Novo DP</Button>
              <Button size="sm" variant="secondary" onClick={() => novo("financeiro")}>💰 Novo Financeiro</Button>
              <Button size="sm" variant="secondary" onClick={() => novo("vendas")}>📊 Novo Altec</Button>
              <Button size="sm" variant="secondary" onClick={() => novo("cardapio")}>🍽️ Novo Cardápio (Puba)</Button>
              <Button size="sm" variant="secondary" onClick={() => novo("cardapio_site")}>🍽️ Novo Cardápio (site)</Button>
            </div>
          </div>

          {agentes.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
              <div className="text-4xl mb-2">🤖</div>
              <p className="text-sm text-gray-500 mb-3">Nenhum agente ainda. Crie os dois padrão (DP + Financeiro) pra começar.</p>
              <Button onClick={() => void seed()}>Criar agentes padrão</Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {agentes.sort((a, b) => a.tipo.localeCompare(b.tipo)).map(a => {
                const cat = CATALOGO[a.tipo];
                const reads = cat.filter(f => f.tipo === "read" && a.tools?.[f.key]).length;
                const escritas = cat.filter(f => f.tipo === "write" && a.tools?.[f.key]).length;
                return (
                  <div key={a.id} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex flex-col gap-2.5 shadow-sm">
                    <div className="w-11 h-11 rounded-xl bg-gray-50 dark:bg-gray-800 grid place-items-center text-2xl">{DOMINIO_META[a.tipo].icon}</div>
                    <div className="min-w-0">
                      <div className="text-[15px] font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5 truncate">{a.nome}{!a.ativo && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800">pausado</span>}</div>
                      <div className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2 min-h-[32px]">{DOMINIO_META[a.tipo].label}</div>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {reads > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{reads} leitura</span>}
                      {escritas > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{escritas} escrita</span>}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      {a.ativo
                        ? <Button size="sm" onClick={() => setConversando(a)} className="flex-1">💬 Conversar</Button>
                        : <span className="flex-1 text-[11px] text-gray-400 self-center">pausado — ative em ⚙</span>}
                      <button type="button" onClick={() => setEditando(a)} title="Configurar" className="w-9 h-9 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center shrink-0">⚙</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : aba === "config" ? (
        <div className="grid grid-cols-1 sm:grid-cols-[210px_1fr] gap-4">
          <div className="flex flex-col gap-1">
            {agentes.sort((a, b) => a.tipo.localeCompare(b.tipo)).map(a => (
              <button key={a.id} type="button" onClick={() => setConfigSel(a.id)} className={`text-left text-sm font-medium px-3 py-2 rounded-lg flex items-center gap-2 ${configSel === a.id ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/25 dark:text-indigo-300" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"}`}>
                {DOMINIO_META[a.tipo].icon} <span className="truncate">{a.nome}</span>
              </button>
            ))}
            <button type="button" onClick={() => novo("cardapio")} className="text-left text-sm font-medium px-3 py-2 rounded-lg text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 mt-1">＋ Subir nova skill</button>
          </div>
          <div>
            {(() => {
              const ag = agentes.find(x => x.id === configSel) || agentes[0];
              return ag
                ? <AgenteEditor key={ag.id} agente={ag} restaurants={restaurants} inline onClose={() => {}} onSalvar={salvar} onExcluir={excluir} />
                : <p className="text-sm text-gray-500 py-8 text-center">Nenhum agente ainda. Crie um na aba Agentes.</p>;
            })()}
          </div>
        </div>
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
      </>)}

      {editando && (
        <AgenteEditor agente={editando} restaurants={restaurants} onClose={() => setEditando(null)} onSalvar={salvar} onExcluir={excluir} />
      )}
    </div>
  );
}

type CardPreco = string | { qual?: string; val: string };
type CardItem = { nome: string; descricao?: string; precos?: CardPreco[] };
type CardSecao = { secao: string; itens?: CardItem[] };
type CardEstado = { comidas?: CardSecao[]; bebidas?: CardSecao[]; vendinha?: CardSecao[]; versao?: number };
type ChatMsg = { id: string; role: "user" | "assistant"; texto: string; tools?: { tool: string; resumo: string }[]; cardapio?: CardEstado; pdfUrl?: string; previaUrl?: string; criadoEm: string; canal?: string; pessoaNome?: string | null; conversaId?: string };

// Prévia leve do cardápio (HTML) — mostrada no chat quando a skill lê/altera.
function CardapioPreview({ e }: { e: CardEstado }) {
  const paginas: [string, CardSecao[] | undefined][] = [["Comidas", e.comidas], ["Bebidas", e.bebidas], ["Vendinha", e.vendinha]];
  const preco = (p: CardPreco) => typeof p === "string" ? p : `${p.qual ? p.qual + " " : ""}${p.val}`;
  return (
    <div className="mt-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden text-gray-800 dark:text-gray-100">
      <div className="px-3 py-1.5 bg-[#2048CE] text-white text-[11px] font-bold flex items-center justify-between">
        <span>🍽️ Prévia do cardápio{e.versao != null ? ` · v${e.versao}` : ""}</span><span className="opacity-80">atualiza na hora</span>
      </div>
      <div className="p-3 max-h-72 overflow-y-auto space-y-2.5">
        {paginas.map(([lbl, secs]) => (secs && secs.length > 0) && (
          <div key={lbl}>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#FC7659] mb-1">{lbl}</div>
            {secs.map((s, si) => (
              <div key={si} className="mb-1.5">
                <div className="text-[10px] font-semibold text-gray-400 uppercase">{s.secao}</div>
                {(s.itens || []).map((it, ii) => (
                  <div key={ii} className="flex justify-between gap-3 text-[12px] py-0.5 border-b border-dashed border-gray-100 dark:border-gray-800 last:border-0">
                    <span className="min-w-0"><span className="font-semibold">{it.nome}</span>{it.descricao ? <span className="text-gray-400"> · {it.descricao}</span> : ""}</span>
                    <span className="font-bold whitespace-nowrap tabular-nums">{(it.precos || []).map(preco).join(" / ")}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function AgenteChat({ agente, pessoaId, pessoaNome, onVoltar, onConfig }: { agente: AgenteIA; pessoaId?: string; pessoaNome?: string; onVoltar: () => void; onConfig: () => void }) {
  // Uma conversa contínua por (agente, pessoa). Persiste em agenteMensagens.
  const conversaId = `${agente.id}__${pessoaId || "anon"}`;
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [texto, setTexto] = useState("");
  const [anexo, setAnexo] = useState<{ base64: string; mediaType: string; nome: string; isPdf: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [gravando, setGravando] = useState(false);
  const [transcrevendo, setTranscrevendo] = useState(false);
  const fimRef = useRef<HTMLDivElement | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Carrega TODAS as mensagens do agente (app + WhatsApp) pra ver a conversa
  // completa; ordena no cliente. O que você digita continua indo pra sua
  // conversa (conversaId do app); as do WhatsApp aparecem marcadas.
  useEffect(() => {
    const q = query(collection(db, "agenteMensagens"), where("agenteId", "==", agente.id));
    const u = onSnapshot(q, s => setMsgs(
      s.docs.map(d => ({ id: d.id, ...(d.data() as Omit<ChatMsg, "id">) }))
        .sort((a, b) => (a.criadoEm || "").localeCompare(b.criadoEm || ""))
    ));
    return () => u();
  }, [agente.id]);
  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length, enviando]);

  async function persistir(role: "user" | "assistant", texto: string, tools?: { tool: string; resumo: string }[], cardapio?: CardEstado, pdfUrl?: string, previaUrl?: string) {
    await addDoc(collection(db, "agenteMensagens"), {
      agenteId: agente.id, conversaId, restaurantId: null, role, texto,
      pessoaId: pessoaId || null, canal: "app", tools: tools || null, cardapio: cardapio || null, pdfUrl: pdfUrl || null, previaUrl: previaUrl || null,
      criadoEm: new Date().toISOString(),
    });
  }
  async function limparConversa() {
    if (!confirm("Apagar a SUA conversa no app? (as mensagens do WhatsApp não são apagadas)")) return;
    const batch = writeBatch(db);
    for (const m of msgs.filter(x => (x.conversaId || conversaId) === conversaId)) batch.delete(doc(db, "agenteMensagens", m.id));
    await batch.commit();
  }

  async function enviarMsg(m: string) {
    if ((!m.trim() && !anexo) || enviando) return;
    setErro(""); setTexto("");
    const anx = anexo; setAnexo(null);
    // Contexto do agente = só a SUA conversa do app (não mistura o WhatsApp de outros).
    const historico = msgs.filter(x => (x.conversaId || conversaId) === conversaId).map(x => ({ role: x.role, texto: x.texto }));
    setEnviando(true);
    try {
      // No histórico exibido marca o anexo; o base64 vai só no turno atual.
      const textoUser = anx ? `📎 ${anx.nome}${m.trim() ? "\n" + m.trim() : ""}` : m;
      await persistir("user", textoUser);
      const r = await fetch("/api/agente", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ agenteId: agente.id, mensagem: m.trim(), historico, pessoaNome, ...(anx ? { anexo: { base64: anx.base64, mediaType: anx.mediaType } } : {}) }) });
      // Resposta pode não ser JSON quando a função estoura o tempo (ex.: PDF pesado) → não quebra.
      const raw = await r.text();
      let j: { error?: string; resposta?: string; toolCalls?: { tool: string; resumo: string }[]; estadoCardapio?: CardEstado; pdfUrl?: string; previaUrl?: string } = {};
      try { j = raw ? JSON.parse(raw) : {}; } catch { j = { error: r.status === 504 || !r.ok ? `O servidor demorou demais pra responder (HTTP ${r.status}). Se pediu PDF, tente de novo — a 1ª geração é mais lenta.` : "Resposta inválida do servidor." }; }
      if (!r.ok) { setErro(j.error || "Falha na resposta."); await persistir("assistant", "⚠️ " + (j.error || "Erro.")); return; }
      await persistir("assistant", j.resposta || "(sem resposta)", j.toolCalls, j.estadoCardapio, j.pdfUrl, j.previaUrl);
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro de rede."); }
    finally { setEnviando(false); }
  }
  const enviar = () => enviarMsg(texto.trim());

  // ── Áudio: grava pelo microfone, transcreve (/api/audio-transcrever) e envia ──
  async function toggleGravar() {
    if (gravando) { recRef.current?.stop(); return; }
    setErro("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setGravando(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 800) return;   // clique acidental
        setTranscrevendo(true);
        try {
          const b64 = await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
            fr.onerror = reject; fr.readAsDataURL(blob);
          });
          const r = await fetch("/api/audio-transcrever", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ audioBase64: b64, mimeType: blob.type }) });
          const j = await r.json();
          if (!r.ok) { setErro(j.error || "Falha ao transcrever."); return; }
          const t = (j.texto || "").trim();
          if (!t) { setErro(j.aviso || "Não entendi o áudio."); return; }
          // Coloca no campo pra o usuário revisar/editar antes de enviar (não manda sozinho).
          setTexto((p) => (p.trim() ? p.trim() + " " + t : t));
        } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao transcrever."); }
        finally { setTranscrevendo(false); }
      };
      recRef.current = rec;
      rec.start();
      setGravando(true);
    } catch { setErro("Não consegui acessar o microfone. Libere o acesso no navegador."); }
  }

  // ── Anexo: imagem (comprimida) ou PDF → base64 pro agente "olhar" ──────────
  function lerBase64(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result).split(",")[1] || ""); fr.onerror = reject; fr.readAsDataURL(file); });
  }
  async function comprimirImagem(file: File): Promise<{ base64: string; mediaType: string }> {
    const dataUrl = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(file); });
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
    const max = 1600; let w = img.width, h = img.height;
    if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { base64: dataUrl.split(",")[1] || "", mediaType: file.type || "image/jpeg" };
    ctx.drawImage(img, 0, 0, w, h);
    return { base64: canvas.toDataURL("image/jpeg", 0.85).split(",")[1] || "", mediaType: "image/jpeg" };
  }
  async function escolherAnexo(file: File) {
    setErro("");
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const isImg = file.type.startsWith("image/");
    if (!isPdf && !isImg) { setErro("Só dá pra anexar imagem ou PDF."); return; }
    try {
      if (isImg) {
        const { base64, mediaType } = await comprimirImagem(file);
        setAnexo({ base64, mediaType, nome: file.name, isPdf: false });
      } else {
        if (file.size > 3_000_000) { setErro("PDF grande demais (máx ~3 MB). Comprima, tire páginas ou mande como imagem."); return; }
        setAnexo({ base64: await lerBase64(file), mediaType: "application/pdf", nome: file.name, isPdf: true });
      }
    } catch { setErro("Não consegui ler o arquivo."); }
  }

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 h-[calc(100vh-140px)] min-h-[420px] flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 dark:border-gray-800">
          <button type="button" onClick={onVoltar} className="text-sm font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">← Voltar</button>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5 min-w-0 truncate">{DOMINIO_META[agente.tipo].icon} {agente.nome}</div>
          <div className="flex items-center gap-1 ml-auto">
            {msgs.length > 0 && <button type="button" onClick={() => void limparConversa()} title="Limpar conversa" className="w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center">🗑</button>}
            <button type="button" onClick={onConfig} title="Configurar" className="w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center">⚙</button>
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
            <div key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
              {m.canal === "whatsapp" && (
                <div className="text-[10px] text-emerald-600 dark:text-emerald-400 mb-0.5 px-1 flex items-center gap-1">
                  <span>📱 WhatsApp</span>{m.pessoaNome && <span className="text-gray-400">· {m.pessoaNome}</span>}
                </div>
              )}
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-indigo-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200"}`}>
                {m.texto}
                {m.tools && m.tools.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {m.tools.map((t, k) => <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200/70 dark:bg-gray-700/70 text-gray-500 dark:text-gray-400">🔎 {t.tool} · {t.resumo}</span>)}
                  </div>
                )}
              </div>
              {m.cardapio && <div className="w-full max-w-[92%]"><CardapioPreview e={m.cardapio} /></div>}
              {m.previaUrl && (
                <a href={m.previaUrl} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <span className="w-8 h-9 rounded bg-amber-500 text-white grid place-items-center text-sm">🔗</span>
                  <span className="text-[13px] font-semibold text-gray-800 dark:text-gray-100">Abrir prévia (HTML) ↗</span>
                </a>
              )}
              {m.pdfUrl && (
                <a href={m.pdfUrl} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <span className="w-8 h-9 rounded bg-[#FC7659] text-white grid place-items-center text-[9px] font-extrabold">PDF</span>
                  <span className="text-[13px] font-semibold text-gray-800 dark:text-gray-100">Baixar filipeta (PDF) ↓</span>
                </a>
              )}
            </div>
          ))}
          {enviando && <div className="text-xs text-gray-400">consultando…</div>}
          {erro && <div className="text-xs text-rose-600">{erro}</div>}
          <div ref={fimRef} />
        </div>

        <div className="p-3 border-t border-gray-100 dark:border-gray-800">
          {anexo && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-2.5 py-1.5 w-fit max-w-full">
              <span className="text-lg shrink-0">{anexo.isPdf ? "📄" : "🖼️"}</span>
              <span className="text-xs text-gray-700 dark:text-gray-200 truncate max-w-[220px]">{anexo.nome}</span>
              <button type="button" onClick={() => setAnexo(null)} title="Remover anexo" className="text-gray-400 hover:text-gray-600 text-xs shrink-0">✕</button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void escolherAnexo(f); e.target.value = ""; }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={enviando}
              title="Anexar imagem ou PDF" className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50">📎</button>
            <button type="button" onClick={() => void toggleGravar()} disabled={enviando || transcrevendo}
              title={gravando ? "Parar e transcrever" : "Gravar áudio"}
              className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border ${gravando ? "bg-rose-600 border-rose-600 text-white animate-pulse" : "border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"} disabled:opacity-50`}>
              {transcrevendo ? "…" : gravando ? "⏹" : "🎤"}
            </button>
            <textarea value={texto} onChange={e => setTexto(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }} rows={1}
              placeholder={gravando ? "Gravando… fale e clique ⏹" : transcrevendo ? "Transcrevendo o áudio…" : anexo ? "Descreva o que quer com o anexo…" : "Escreva, anexe ou grave um áudio…"}
              className="flex-1 resize-none text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 max-h-28" />
            <Button disabled={enviando || (!texto.trim() && !anexo)} onClick={() => void enviar()}>{enviando ? "…" : "Enviar"}</Button>
          </div>
        </div>
    </div>
  );
}

function AgenteEditor({ agente, restaurants, onClose, onSalvar, onExcluir, inline }: {
  agente: AgenteIA; restaurants: { id: string; nome?: string }[]; inline?: boolean;
  onClose: () => void; onSalvar: (a: AgenteIA) => Promise<void>; onExcluir: (id: string) => Promise<void>;
}) {
  const [a, setA] = useState<AgenteIA>(agente);
  const [busy, setBusy] = useState(false);
  const [numInput, setNumInput] = useState("");
  const addNumero = () => {
    const d = numInput.replace(/\D/g, "");
    if (d.length < 10) { setNumInput(""); return; }
    setA(p => ({ ...p, numerosWhatsapp: [...new Set([...(p.numerosWhatsapp || []), d])] }));
    setNumInput("");
  };
  async function subirSkill(file: File) {
    const txt = await file.text();
    // Tira o front-matter (--- ... ---) do SKILL.md, se houver; o resto vira persona.
    const corpo = txt.replace(/^---[\s\S]*?---\s*/, "").trim();
    if (corpo) setA(p => ({ ...p, systemPrompt: corpo }));
  }
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

  const conteudo = (<>
        {!inline && <button type="button" onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center">✕</button>}
        <div className="text-[11px] font-medium text-gray-400 mb-1">{DOMINIO_META[a.tipo].icon} Agente de {DOMINIO_META[a.tipo].label}</div>

        <label className="block text-xs font-semibold text-gray-500 mb-1">Nome</label>
        <input value={a.nome} onChange={e => setA({ ...a, nome: e.target.value })} className={inp + " mb-3"} />

        <label className="block text-xs font-semibold text-gray-500 mb-1">Instruções (persona)</label>
        <textarea value={a.systemPrompt || ""} onChange={e => setA({ ...a, systemPrompt: e.target.value })} rows={4} className={inp + " mb-2 resize-y"} />
        <label className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-300 mb-3 cursor-pointer w-fit">
          <span className="px-2.5 py-1 rounded-lg border border-dashed border-indigo-300 dark:border-indigo-700">⬆︎ Subir/atualizar skill (SKILL.md)</span>
          <input type="file" accept=".md,.txt,text/markdown,text/plain" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void subirSkill(f); e.target.value = ""; }} />
        </label>

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

        <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
          <input type="checkbox" checked={a.ativo} onChange={e => setA({ ...a, ativo: e.target.checked })} className="w-4 h-4" />
          <span className="text-gray-700 dark:text-gray-300">Agente ativo</span>
        </label>

        <div className="text-xs font-semibold text-gray-500 mb-1.5">📱 WhatsApp — números autorizados</div>
        <p className="text-[11px] text-gray-400 mb-2">Quem pode falar com este agente pelo número da API oficial. Sem número aqui, o agente atende só no chat do app. Se a pessoa tiver mais de um agente liberado, o WhatsApp mostra um menu pra escolher.</p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {(a.numerosWhatsapp || []).map((n, i) => (
            <span key={n + i} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/25 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              📱 {n}
              <button type="button" onClick={() => setA(p => ({ ...p, numerosWhatsapp: (p.numerosWhatsapp || []).filter((_, k) => k !== i) }))} className="text-emerald-500 hover:text-emerald-700" title="Remover">✕</button>
            </span>
          ))}
          {(a.numerosWhatsapp || []).length === 0 && <span className="text-[11px] text-gray-400 italic">Nenhum número — não atende no WhatsApp.</span>}
        </div>
        <div className="flex gap-1.5 mb-4">
          <input value={numInput} onChange={e => setNumInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addNumero(); } }} placeholder="Ex: 91 98549-9821 (com DDD)" className={inp + " flex-1"} />
          <button type="button" onClick={addNumero} className="text-xs font-semibold px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 shrink-0">Adicionar</button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button variant="danger" size="sm" disabled={busy} onClick={() => void onExcluir(a.id)}>Excluir</Button>
          <Button disabled={busy || !a.nome.trim()} onClick={async () => { setBusy(true); try { await onSalvar(a); } finally { setBusy(false); } }}>{busy ? "…" : "Salvar"}</Button>
        </div>
  </>);
  return inline
    ? <div className="relative rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">{conteudo}</div>
    : (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="relative bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg max-h-[88vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>{conteudo}</div>
      </div>
    );
}
