// Wiki de Processos — Guias por ÁREA + agente de IA por área.
// Cada área (Pessoas, Financeiro, Compras, Eventos) tem:
//   • um GUIA HTML de funcionamento (autocontido, aberto num iframe);
//   • um AGENTE DE IA que responde dúvidas da equipe SÓ a partir do guia daquela área.
// O guia vem do banco (coleção `wikiGuias`, doc id = key da área); Pessoas tem uma
// semente bundlada (guias/pessoas.html) que serve de default até o upload no app.
// Editar o guia = subir/colar o HTML (sem deploy). Fonte da IA = texto do guia.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, doc, setDoc, deleteDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { authHeader } from "../../core/firebase/idToken";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { useDitado } from "../../core/hooks/useDitado";
import { transcreverAudio } from "../../core/hooks/transcreverAudio";
import { Button } from "../../core/ui/Button";
import { fmtBR } from "../../core/utils/date";
import { WIKI_AREAS, GUIA_SEED, tipoDeArquivo, TIPO_ICON, type WikiAreaKey, type WikiAreaMeta, type WikiGuia, type WikiDoc } from "../../core/wiki/areas";

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// Achata o guia HTML em texto puro pra mandar de contexto pro agente da área.
function htmlToTexto(html: string): string {
  try {
    const d = new DOMParser().parseFromString(html, "text/html");
    d.querySelectorAll("script,style,noscript").forEach(n => n.remove());
    return (d.body?.textContent || "").replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  } catch { return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
}

export function WikiProcessosPage() {
  const { pessoa } = useAuth();
  const { rid } = useParams<{ rid: string }>();
  const { can, loading: loadingPerfis } = useCanAcao(rid || "");
  const master = !!pessoa?.isMaster;
  const podeAbrir = (k: WikiAreaKey) => master || can("wikiProcessos", `abrir_${k}`) || can("wikiProcessos", `editar_${k}`);
  const podeEditarArea = (k: WikiAreaKey) => master || can("wikiProcessos", `editar_${k}`);

  const [guias, setGuias] = useState<Record<string, WikiGuia>>({});
  const [docs, setDocs] = useState<WikiDoc[]>([]);
  const [diretrizes, setDiretrizes] = useState("");
  const [verGuia, setVerGuia] = useState<WikiAreaMeta | null>(null);
  const [chat, setChat] = useState<WikiAreaMeta | null>(null);
  const [editar, setEditar] = useState<WikiAreaMeta | null>(null);
  const [acervo, setAcervo] = useState<WikiAreaMeta | null>(null);

  useEffect(() => {
    const ug = onSnapshot(collection(db, "wikiGuias"), snap => {
      const m: Record<string, WikiGuia> = {};
      snap.docs.forEach(d => { m[d.id] = { key: d.id as WikiAreaKey, ...(d.data() as object) } as WikiGuia; });
      setGuias(m);
    });
    const ud = onSnapshot(collection(db, "wikiDocs"), snap =>
      setDocs(snap.docs.map(d => ({ id: d.id, ...(d.data() as object) }) as WikiDoc)));
    return () => { ug(); ud(); };
  }, []);
  useEffect(() => {
    if (!rid) return;
    const ui = onSnapshot(doc(db, "iaConfig", rid), snap => setDiretrizes((snap.data() as { diretrizes?: string } | undefined)?.diretrizes || ""));
    return () => ui();
  }, [rid]);

  if (!pessoa) return null;
  if (loadingPerfis) return <div className="max-w-5xl mx-auto p-6 text-sm text-gray-400">Carregando…</div>;

  // Só as áreas que o perfil pode abrir (ou editar). Permissão é por área.
  const areasVis = WIKI_AREAS.filter(a => podeAbrir(a.key));
  if (areasVis.length === 0) return <div className="max-w-5xl mx-auto p-8 text-center text-gray-500">Você não tem permissão para acessar a Wiki de Processos.</div>;

  // HTML efetivo: override do banco tem prioridade; senão cai na semente bundlada.
  const htmlDe = (k: WikiAreaKey) => (guias[k]?.html?.trim() || GUIA_SEED[k] || "");
  const docsDe = (k: WikiAreaKey) => docs.filter(d => d.area === k).sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
  // Corpus que alimenta o agente da área: guia (em texto) + textos do acervo.
  const corpusDe = (k: WikiAreaKey) => {
    const partes: string[] = [];
    const g = htmlToTexto(htmlDe(k));
    if (g) partes.push(`===== GUIA DE FUNCIONAMENTO =====\n${g}`);
    for (const d of docsDe(k)) if (d.texto?.trim()) partes.push(`===== DOCUMENTO: ${d.nome} =====\n${d.texto.trim()}`);
    return partes.join("\n\n").slice(0, 118000);
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">📚 Wiki de Processos</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Guia de funcionamento de cada área — e um assistente de IA que responde as dúvidas da equipe a partir do guia.</p>
      </header>

      {areasVis.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">Seu perfil não tem nenhuma área da Wiki liberada.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {areasVis.map(a => {
            const html = htmlDe(a.key);
            const g = guias[a.key];
            const temGuia = !!html;
            const semente = !g?.html?.trim() && !!GUIA_SEED[a.key];
            const nDocs = docsDe(a.key).length;
            const temFonte = temGuia || nDocs > 0;   // IA responde se há guia OU acervo
            return (
              <div key={a.key} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex flex-col"
                style={{ borderTopWidth: 3, borderTopColor: a.cor }}>
                <div className="flex items-start gap-3">
                  <div className="text-3xl leading-none">{a.emoji}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-gray-900 dark:text-gray-100">{a.nome}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{a.desc}</div>
                  </div>
                </div>
                <div className="text-[11px] text-gray-400 mt-3">
                  {temGuia
                    ? <>Guia publicado{g?.atualizadoEm ? ` · atualizado ${fmtBR(g.atualizadoEm)}` : semente ? " · modelo inicial" : ""}</>
                    : <span className="text-amber-600 dark:text-amber-400">Guia ainda não publicado</span>}
                  {nDocs > 0 && <> · 📎 {nDocs} {nDocs === 1 ? "documento" : "documentos"} no acervo</>}
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Button variant="secondary" onClick={() => setVerGuia(a)} disabled={!temGuia}>📖 Abrir guia</Button>
                  <Button variant="secondary" onClick={() => setChat(a)} disabled={!temFonte}>🤖 Pergunte à IA</Button>
                  <Button variant="ghost" onClick={() => setAcervo(a)}>📎 Acervo{nDocs > 0 ? ` (${nDocs})` : ""}</Button>
                  {podeEditarArea(a.key) && <Button variant="ghost" onClick={() => setEditar(a)}>⬆️ {temGuia ? "Atualizar guia" : "Publicar guia"}</Button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {verGuia && <GuiaViewerModal area={verGuia} html={htmlDe(verGuia.key)} onClose={() => setVerGuia(null)} />}
      {chat && (
        <AreaChatModal area={chat} fonteTexto={corpusDe(chat.key)} nDocs={docsDe(chat.key).length} diretrizes={diretrizes}
          rid={rid || ""} pessoaId={pessoa.id} pessoaNome={pessoa.nome} onClose={() => setChat(null)} />
      )}
      {editar && podeEditarArea(editar.key) && (
        <GuiaUploadModal area={editar} atual={guias[editar.key]} temSeed={!!GUIA_SEED[editar.key]}
          pessoaId={pessoa.id} pessoaNome={pessoa.nome} onClose={() => setEditar(null)} />
      )}
      {acervo && (
        <AcervoModal area={acervo} docs={docsDe(acervo.key)} podeEditar={podeEditarArea(acervo.key)}
          pessoaId={pessoa.id} pessoaNome={pessoa.nome} onClose={() => setAcervo(null)} />
      )}
    </div>
  );
}

// ─── Visualizador do guia (iframe isolado) ───────────────────────────────────
function GuiaViewerModal({ area, html, onClose }: { area: WikiAreaMeta; html: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between gap-2 px-4 py-2 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800" onClick={e => e.stopPropagation()}>
        <div className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">{area.emoji} Guia — {area.nome}</div>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-2">✕</button>
      </div>
      <iframe
        title={`Guia ${area.nome}`}
        srcDoc={html}
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        className="flex-1 w-full bg-white border-0"
        onClick={e => e.stopPropagation()}
      />
    </div>
  );
}

// ─── Agente de IA por área (responde SÓ a partir do guia da área) ────────────
type ChatMsg = { role: "user" | "ia"; texto: string };
function AreaChatModal({ area, fonteTexto, nDocs, diretrizes, rid, pessoaId, pessoaNome, onClose }: {
  area: WikiAreaMeta; fonteTexto: string; nDocs: number; diretrizes: string; rid: string; pessoaId: string; pessoaNome: string; onClose: () => void;
}) {
  const [pergunta, setPergunta] = useState("");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [transcrevendo, setTranscrevendo] = useState(false);
  const dit = useDitado();
  const valorInput = dit.gravando ? (dit.transcricao + (dit.parcial ? (dit.transcricao ? " " : "") + dit.parcial : "")) : pergunta;

  function micToggle() {
    if (dit.gravando) { dit.parar(); setPergunta((dit.transcricao + " " + dit.parcial).replace(/\s+/g, " ").trim()); }
    else { setErro(""); dit.setTranscricao(pergunta); dit.setParcial(""); dit.iniciar(); }
  }

  async function enviar() {
    const q = (dit.gravando ? (dit.transcricao + " " + dit.parcial) : pergunta).replace(/\s+/g, " ").trim();
    if (!q || carregando) return;
    if (dit.gravando) dit.parar();
    setErro("");
    setMsgs(m => [...m, { role: "user", texto: q }]);
    setPergunta(""); dit.setTranscricao(""); dit.setParcial("");
    setCarregando(true);
    try {
      const r = await fetch("/api/wiki-perguntar", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ pergunta: q, diretrizes, guia: fonteTexto, areaNome: area.nome, processos: [] }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      setMsgs(m => [...m, { role: "ia", texto: String(data.resposta || "") }]);
      // Registro jurídico da interação (LGPD/auditoria). Best-effort.
      if (rid) {
        const iid = `ia-${uid()}`;
        setDoc(doc(db, "iaInteracoes", iid), sanitizeForFirestore({
          id: iid, restaurantId: rid, moduleId: "wikiProcessos", moduleLabel: `Wiki de Processos · ${area.nome}`,
          canal: `pergunte-ia-${area.key}`, area: area.key,
          pessoaId, pessoaNome, pergunta: q, resposta: String(data.resposta || ""),
          foraDeEscopo: data.foraDeEscopo === true, motivo: String(data.motivo || ""), severidade: String(data.severidade || "baixa"),
          createdAt: new Date().toISOString(),
        })).catch(() => {});
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao consultar a IA.");
    } finally { setCarregando(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl flex flex-col max-h-[88vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 p-4 border-b border-gray-100 dark:border-gray-800">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{area.emoji} Assistente de {area.nome}</h2>
            <div className="text-xs text-gray-500">Respostas a partir do guia{nDocs > 0 ? ` e de ${nDocs} ${nDocs === 1 ? "documento" : "documentos"} do acervo` : " de funcionamento da área"}.</div>
            <div className="text-[10px] text-gray-400 mt-0.5">🔒 LGPD: as interações com a IA são registradas.</div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[180px]">
          {msgs.length === 0 && (
            <div className="text-center text-gray-500 dark:text-gray-400 py-6">
              <div className="text-3xl mb-2">💬</div>
              <p className="text-sm">Pergunte qualquer coisa sobre os processos de {area.nome}.</p>
            </div>
          )}
          {msgs.map((m, i) => m.role === "user" ? (
            <div key={i} className="flex justify-end"><div className="max-w-[85%] bg-indigo-600 text-white rounded-2xl rounded-br-sm px-3.5 py-2 text-sm whitespace-pre-wrap">{m.texto}</div></div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[90%] bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm whitespace-pre-wrap leading-relaxed">{m.texto}</div>
            </div>
          ))}
          {carregando && <div className="flex justify-start"><div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm text-gray-500">Consultando o guia…</div></div>}
          {erro && <div className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">{erro}</div>}
        </div>

        <div className="px-3 pt-2 border-t border-gray-100 dark:border-gray-800">
          {dit.gravando && <div className="text-[11px] text-rose-600 mb-1 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse" /> Ouvindo… fale sua pergunta</div>}
          {dit.erroMic && <div className="text-[11px] text-rose-600 mb-1">{dit.erroMic}</div>}
        </div>
        <div className="p-3 pt-1 flex gap-2 items-center">
          <button type="button" onClick={micToggle} disabled={carregando || transcrevendo} title={dit.gravando ? "Parar" : "Perguntar por voz"}
            className={`shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center text-lg ${dit.gravando ? "border-rose-400 bg-rose-50 dark:bg-rose-900/20 text-rose-600" : "border-gray-300 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>{dit.gravando ? "⏹️" : "🎙️"}</button>
          <label title="Enviar arquivo de áudio (ex.: WhatsApp)" className={`shrink-0 w-10 h-10 rounded-xl border border-gray-300 dark:border-gray-700 flex items-center justify-center text-lg cursor-pointer text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 ${carregando || transcrevendo ? "opacity-40 pointer-events-none" : ""}`}>
            {transcrevendo ? "…" : "📎"}
            <input type="file" accept="audio/*" className="hidden" onChange={async e => { const file = e.target.files?.[0]; e.currentTarget.value = ""; if (!file) return; setTranscrevendo(true); setErro(""); try { const t = await transcreverAudio(file); if (t) setPergunta(p => (p ? p + " " : "") + t); else setErro("Não consegui entender o áudio."); } catch (err) { setErro(err instanceof Error ? err.message : "Falha ao transcrever."); } finally { setTranscrevendo(false); } }} />
          </label>
          <input value={valorInput} onChange={e => { setPergunta(e.target.value); if (dit.gravando) dit.parar(); }} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
            placeholder="Digite ou fale…" autoFocus disabled={carregando}
            className="flex-1 min-w-0 h-10 px-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
          <button type="button" onClick={enviar} disabled={carregando || !valorInput.trim()} className="shrink-0 h-10 px-3 rounded-xl bg-indigo-600 text-white text-sm font-medium disabled:opacity-40">Enviar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Publicar / atualizar o guia HTML da área (admin) ────────────────────────
const MAX_HTML = 900_000; // margem sob o limite de 1MB do doc Firestore
function GuiaUploadModal({ area, atual, temSeed, pessoaId, pessoaNome, onClose }: {
  area: WikiAreaMeta; atual?: WikiGuia; temSeed: boolean; pessoaId: string; pessoaNome: string; onClose: () => void;
}) {
  const [html, setHtml] = useState(atual?.html || "");
  const [resumo, setResumo] = useState(atual?.resumo || "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const inp = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100";

  async function lerArquivo(f: File) {
    setErro("");
    const t = await f.text();
    if (t.length > MAX_HTML) { setErro(`Arquivo muito grande (${Math.round(t.length / 1024)} KB). Limite ~900 KB.`); return; }
    setHtml(t);
  }
  async function salvar() {
    if (html.length > MAX_HTML) { setErro(`HTML muito grande (${Math.round(html.length / 1024)} KB). Limite ~900 KB.`); return; }
    setSalvando(true); setErro("");
    try {
      await setDoc(doc(db, "wikiGuias", area.key), sanitizeForFirestore({
        key: area.key, html, resumo: resumo.trim() || undefined,
        atualizadoEm: new Date().toISOString(), atualizadoPor: pessoaId, atualizadoPorNome: pessoaNome,
      }), { merge: true });
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally { setSalvando(false); }
  }
  async function restaurarSemente() {
    if (!confirm("Restaurar o modelo inicial deste guia? O HTML que você subiu será removido e o guia volta pra versão embutida no sistema.")) return;
    setSalvando(true); setErro("");
    try {
      await setDoc(doc(db, "wikiGuias", area.key), sanitizeForFirestore({
        key: area.key, html: "", atualizadoEm: new Date().toISOString(), atualizadoPor: pessoaId, atualizadoPorNome: pessoaNome,
      }), { merge: true });
      onClose();
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao restaurar."); }
    finally { setSalvando(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 p-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{area.emoji} Guia — {area.nome}</h2>
            <div className="text-xs text-gray-500">Suba o arquivo <b>.html</b> ou cole o HTML. Salva na hora, sem deploy.</div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 cursor-pointer text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
            📎 Escolher arquivo .html
            <input type="file" accept=".html,text/html" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) void lerArquivo(f); }} />
          </label>
          {html && <div className="text-[11px] text-gray-400">{Math.round(html.length / 1024)} KB carregados.</div>}

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">HTML do guia</label>
            <textarea value={html} onChange={e => setHtml(e.target.value)} rows={10} spellCheck={false}
              placeholder="Cole aqui o HTML do guia, ou use o botão acima pra subir o arquivo." className={`${inp} mt-1 font-mono text-[11px] leading-snug`} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Resumo (opcional)</label>
            <input value={resumo} onChange={e => setResumo(e.target.value)} placeholder="Uma linha sobre o guia" className={`${inp} mt-1`} />
          </div>
          {erro && <div className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">{erro}</div>}
        </div>

        <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
          {temSeed ? <button type="button" onClick={restaurarSemente} disabled={salvando} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline">Restaurar modelo inicial</button> : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando || !html.trim()}>{salvando ? "Salvando…" : "Salvar guia"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Acervo da área (documentos de referência que a IA consulta) ─────────────
const slug = (s: string) => (s || "arquivo").replace(/[^\w.\-]+/g, "_").slice(0, 80);
function AcervoModal({ area, docs, podeEditar, pessoaId, pessoaNome, onClose }: {
  area: WikiAreaMeta; docs: WikiDoc[]; podeEditar: boolean; pessoaId: string; pessoaNome: string; onClose: () => void;
}) {
  const [addModo, setAddModo] = useState<null | "arquivo" | "texto">(null);
  const [file, setFile] = useState<File | null>(null);
  const [nome, setNome] = useState("");
  const [texto, setTexto] = useState("");
  const [status, setStatus] = useState("");
  const [erro, setErro] = useState("");
  const salvando = !!status;
  const inp = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100";

  function reset() { setAddModo(null); setFile(null); setNome(""); setTexto(""); setStatus(""); setErro(""); }

  async function extrairTexto(f: File, tipo: string, url: string): Promise<string> {
    if (tipo === "html") return htmlToTexto(await f.text());
    if (tipo === "texto") return (await f.text()).slice(0, 200000);
    if (tipo === "pdf" || tipo === "imagem") {
      const r = await fetch("/api/wiki-extrair", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ fileUrl: url, mime: f.type }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      return String(d.texto || "");
    }
    return ""; // outro (docx/doc): fica só pra download; use "colar texto" p/ entrar na IA
  }

  async function salvarArquivo() {
    if (!file) return;
    setErro(""); setStatus("Subindo arquivo…");
    try {
      const tipo = tipoDeArquivo(file.type, file.name);
      const id = `doc-${uid()}`;
      const path = `wiki-acervo/${area.key}/${Date.now()}_${slug(file.name)}`;
      await uploadBytes(storageRef(storage, path), file, { contentType: file.type || "application/octet-stream" });
      const url = await getDownloadURL(storageRef(storage, path));
      let txt = "";
      if (tipo === "pdf" || tipo === "imagem") setStatus("Extraindo texto (pode levar alguns segundos)…");
      try { txt = await extrairTexto(file, tipo, url); } catch (e) { setErro(`Arquivo salvo, mas a extração de texto falhou: ${e instanceof Error ? e.message : ""}. O documento fica pra download; a IA não vai lê-lo até você colar o texto.`); }
      await setDoc(doc(db, "wikiDocs", id), sanitizeForFirestore({
        id, area: area.key, nome: (nome.trim() || file.name), tipo, url, storagePath: path,
        texto: txt || undefined, tamanho: file.size,
        atualizadoEm: new Date().toISOString(), atualizadoPor: pessoaId, atualizadoPorNome: pessoaNome,
      }));
      reset();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar o documento.");
      setStatus("");
    }
  }

  async function salvarTexto() {
    if (!nome.trim() || !texto.trim()) return;
    setErro(""); setStatus("Salvando…");
    try {
      const id = `doc-${uid()}`;
      await setDoc(doc(db, "wikiDocs", id), sanitizeForFirestore({
        id, area: area.key, nome: nome.trim(), tipo: "texto", texto: texto.slice(0, 200000),
        atualizadoEm: new Date().toISOString(), atualizadoPor: pessoaId, atualizadoPorNome: pessoaNome,
      }));
      reset();
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao salvar."); setStatus(""); }
  }

  async function remover(d: WikiDoc) {
    if (!confirm(`Remover "${d.nome}" do acervo de ${area.nome}?`)) return;
    try {
      await deleteDoc(doc(db, "wikiDocs", d.id));
      if (d.storagePath) deleteObject(storageRef(storage, d.storagePath)).catch(() => {});
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao remover."); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 p-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{area.emoji} Acervo — {area.nome}</h2>
            <div className="text-xs text-gray-500">Documentos de referência que o assistente de {area.nome} consulta (regulamento, convenção, modelos…).</div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="p-4 space-y-2 overflow-y-auto">
          {docs.length === 0 && !addModo && (
            <div className="text-center text-gray-500 dark:text-gray-400 py-6 text-sm">Nenhum documento no acervo ainda.{podeEditar ? " Adicione o primeiro abaixo." : ""}</div>
          )}
          {docs.map(d => (
            <div key={d.id} className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2">
              <div className="text-xl">{TIPO_ICON[d.tipo] || "📎"}</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{d.nome}</div>
                <div className="text-[11px] text-gray-400">
                  {d.tamanho ? `${Math.round(d.tamanho / 1024)} KB · ` : ""}{d.texto ? "na IA" : <span className="text-amber-600">só download (sem texto na IA)</span>}{d.atualizadoEm ? ` · ${fmtBR(d.atualizadoEm)}` : ""}
                </div>
              </div>
              {d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline shrink-0">⬇️ baixar</a>}
              {podeEditar && <button type="button" onClick={() => void remover(d)} className="text-gray-400 hover:text-rose-600 text-sm shrink-0" title="Remover">🗑️</button>}
            </div>
          ))}

          {podeEditar && addModo === "arquivo" && (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-3 space-y-2 mt-2">
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 cursor-pointer text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                📎 Escolher arquivo
                <input type="file" accept=".pdf,.html,.htm,.txt,.md,.png,.jpg,.jpeg,.webp,image/*,application/pdf" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) { setFile(f); setNome(f.name); setErro(""); } }} />
              </label>
              {file && <div className="text-[11px] text-gray-500">{file.name} · {Math.round(file.size / 1024)} KB · {tipoDeArquivo(file.type, file.name)}{["pdf", "imagem"].includes(tipoDeArquivo(file.type, file.name)) ? " (a IA extrai o texto ao salvar)" : tipoDeArquivo(file.type, file.name) === "outro" ? " (só download — cole o texto se quiser que a IA use)" : ""}</div>}
              <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome do documento" className={inp} />
              {status && <div className="text-xs text-gray-500">{status}</div>}
              {erro && <div className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">{erro}</div>}
              <div className="flex gap-2 justify-end">
                <Button variant="secondary" onClick={reset} disabled={salvando}>Cancelar</Button>
                <Button onClick={salvarArquivo} disabled={salvando || !file}>{salvando ? "Salvando…" : "Adicionar"}</Button>
              </div>
            </div>
          )}
          {podeEditar && addModo === "texto" && (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-3 space-y-2 mt-2">
              <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome do documento (ex.: Regulamento Interno)" className={inp} />
              <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={8} placeholder="Cole aqui o texto do documento…" className={`${inp} text-[13px]`} />
              {status && <div className="text-xs text-gray-500">{status}</div>}
              {erro && <div className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">{erro}</div>}
              <div className="flex gap-2 justify-end">
                <Button variant="secondary" onClick={reset} disabled={salvando}>Cancelar</Button>
                <Button onClick={salvarTexto} disabled={salvando || !nome.trim() || !texto.trim()}>{salvando ? "Salvando…" : "Adicionar"}</Button>
              </div>
            </div>
          )}
        </div>

        {podeEditar && !addModo && (
          <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => { setErro(""); setAddModo("texto"); }}>✍️ Colar texto</Button>
            <Button onClick={() => { setErro(""); setAddModo("arquivo"); }}>📎 Subir arquivo</Button>
          </div>
        )}
      </div>
    </div>
  );
}
