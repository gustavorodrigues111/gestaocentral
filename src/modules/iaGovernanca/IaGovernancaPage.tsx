// Governança de IA (SÓ MASTER) — diretrizes do que a IA pode/não pode responder,
// em BLOCOS independentes (adicionados por texto ou voz; a IA checa contradição/
// redundância a cada novo bloco). Registro jurídico das interações (auditoria).
// Alertas de uso fora do escopo saem na Central de Avisos (gate receberAlertas).
// Diretrizes por empresa, replicáveis pra outras.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, where, doc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { authHeader } from "../../core/firebase/idToken";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useDitado } from "../../core/hooks/useDitado";
import { Button } from "../../core/ui/Button";
import { fmtBR } from "../../core/utils/date";

type DiretrizBloco = { id: string; texto: string; criadoEm: string; criadoPor: string };
type IaInteracao = {
  id: string; restaurantId: string; moduleLabel?: string; canal?: string;
  pessoaId?: string; pessoaNome?: string; pergunta?: string; resposta?: string;
  foraDeEscopo?: boolean; motivo?: string; createdAt?: string;
};
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
// String derivada (o endpoint da IA e o cliente da Wiki consomem `diretrizes`).
const juntarBlocos = (bs: DiretrizBloco[]) => bs.map(b => `- ${b.texto}`).join("\n");

export function IaGovernancaPage() {
  const { pessoa } = useAuth();
  const { rid } = useParams<{ rid: string }>();
  const { restaurants } = useRestaurant();

  const [aba, setAba] = useState<"diretrizes" | "registros">("diretrizes");
  const [blocos, setBlocos] = useState<DiretrizBloco[]>([]);
  const [carregou, setCarregou] = useState(false);
  const [replicar, setReplicar] = useState(false);
  const [interacoes, setInteracoes] = useState<IaInteracao[]>([]);
  const [filtro, setFiltro] = useState<"todas" | "fora">("todas");
  const [aberta, setAberta] = useState<string | null>(null);

  useEffect(() => {
    if (!rid) return;
    const u = onSnapshot(doc(db, "iaConfig", rid), snap => {
      const d = snap.data() as { diretrizesBlocos?: DiretrizBloco[]; diretrizes?: string } | undefined;
      if (d?.diretrizesBlocos && d.diretrizesBlocos.length) setBlocos(d.diretrizesBlocos);
      else if (d?.diretrizes && d.diretrizes.trim()) setBlocos([{ id: uid(), texto: d.diretrizes.trim(), criadoEm: new Date().toISOString(), criadoPor: "migrado" }]);
      else setBlocos([]);
      setCarregou(true);
    });
    return () => u();
  }, [rid]);

  useEffect(() => {
    if (!rid || !pessoa?.isMaster) return;
    const u = onSnapshot(query(collection(db, "iaInteracoes"), where("restaurantId", "==", rid)),
      snap => setInteracoes(snap.docs.map(d => ({ id: d.id, ...d.data() }) as IaInteracao).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))));
    return () => u();
  }, [rid, pessoa?.isMaster]);

  if (!pessoa) return null;
  if (!pessoa.isMaster) return <div className="max-w-4xl mx-auto p-8 text-center text-gray-500">A Governança de IA é exclusiva do administrador master.</div>;

  async function persistir(novos: DiretrizBloco[]) {
    if (!rid) return;
    setBlocos(novos);
    await setDoc(doc(db, "iaConfig", rid), sanitizeForFirestore({
      restaurantId: rid, diretrizesBlocos: novos, diretrizes: juntarBlocos(novos),
      atualizadoEm: new Date().toISOString(), atualizadoPor: pessoa!.id,
    }), { merge: true }).catch(e => alert("Erro ao salvar: " + (e instanceof Error ? e.message : "?")));
  }
  const addBloco = (texto: string) => persistir([...blocos, { id: uid(), texto: texto.trim(), criadoEm: new Date().toISOString(), criadoPor: pessoa!.id }]);
  const removeBloco = (id: string) => persistir(blocos.filter(b => b.id !== id));

  const registrosVis = interacoes.filter(i => filtro === "todas" || i.foraDeEscopo);
  const nFora = interacoes.filter(i => i.foraDeEscopo).length;

  const tabBtn = (val: "diretrizes" | "registros", label: string, badge?: number) => (
    <button type="button" onClick={() => setAba(val)}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${aba === val ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>
      {label}{badge ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{badge}</span> : null}
    </button>
  );

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">🛡️ Governança de IA</h1>
      <p className="text-xs text-gray-500 mb-4">Módulo exclusivo do master. Diretrizes em blocos do que a IA pode responder, registro das interações e alertas de uso fora do escopo (LGPD).</p>

      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 mb-4">
        {tabBtn("diretrizes", "📋 Diretrizes")}
        {tabBtn("registros", "🗂️ Registros", nFora)}
      </div>

      {aba === "diretrizes" ? (
        <div className="space-y-3">
          <div className="text-sm text-gray-500">{blocos.length} diretriz{blocos.length === 1 ? "" : "es"} nesta empresa. Cada bloco é uma regra independente; a IA checa se um novo bloco contradiz os demais.</div>

          {/* Lista de blocos */}
          {blocos.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm rounded-xl border border-dashed border-gray-200 dark:border-gray-800">Nenhuma diretriz ainda. Adicione a primeira abaixo.</div>
          ) : (
            <div className="space-y-2">
              {blocos.map((b, i) => (
                <div key={b.id} className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                  <div className="flex-1 min-w-0 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">{b.texto}</div>
                  <button type="button" onClick={() => { if (confirm("Remover esta diretriz?")) removeBloco(b.id); }} className="shrink-0 text-gray-400 hover:text-rose-600 text-sm">🗑️</button>
                </div>
              ))}
            </div>
          )}

          {/* Adicionar bloco (texto/voz + checagem) */}
          <AdicionarDiretriz existentes={blocos.map(b => b.texto)} onAdd={addBloco} />

          {/* Replicar */}
          <div className="flex justify-end pt-1">
            <Button variant="secondary" onClick={() => setReplicar(true)} disabled={!carregou || blocos.length === 0}>📑 Copiar diretrizes para outras empresas</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm text-gray-500">{interacoes.length} interaç{interacoes.length === 1 ? "ão" : "ões"} registrada{interacoes.length === 1 ? "" : "s"}{nFora > 0 ? ` · ${nFora} fora do escopo` : ""}</div>
            <div className="flex gap-1.5 ml-auto">
              <Chip active={filtro === "todas"} onClick={() => setFiltro("todas")}>Todas</Chip>
              <Chip active={filtro === "fora"} onClick={() => setFiltro("fora")}>⚠️ Fora do escopo</Chip>
            </div>
          </div>
          {registrosVis.length === 0 ? (
            <div className="text-center py-10 text-gray-500 dark:text-gray-400 text-sm">Nenhum registro {filtro === "fora" ? "fora do escopo " : ""}ainda.</div>
          ) : (
            <div className="space-y-2">
              {registrosVis.map(i => (
                <div key={i.id} className={`rounded-xl border p-3 ${i.foraDeEscopo ? "border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-900/10" : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"}`}>
                  <button type="button" onClick={() => setAberta(aberta === i.id ? null : i.id)} className="w-full text-left">
                    <div className="flex items-center gap-2 flex-wrap">
                      {i.foraDeEscopo && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">⚠️ Fora do escopo</span>}
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{i.pessoaNome || "—"}</span>
                      <span className="text-[11px] text-gray-400">{i.moduleLabel || "IA"} · {fmtBR((i.createdAt || "").slice(0, 10))}</span>
                    </div>
                    <div className="text-sm text-gray-700 dark:text-gray-300 mt-1 line-clamp-2">“{i.pergunta}”</div>
                    {i.foraDeEscopo && i.motivo && <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">Motivo: {i.motivo}</div>}
                  </button>
                  {aberta === i.id && (
                    <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                      <div className="text-[11px] font-semibold text-gray-500 mb-1">Resposta da IA</div>
                      <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{i.resposta || "—"}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {replicar && <ReplicarModal blocos={blocos} restaurantes={restaurants.filter(r => r.id !== rid).map(r => ({ id: r.id, nome: r.nome }))} pessoaId={pessoa.id} onClose={() => setReplicar(false)} />}
    </div>
  );
}

// Adicionar diretriz: texto ou voz, com checagem de contradição/redundância pela IA.
function AdicionarDiretriz({ existentes, onAdd }: { existentes: string[]; onAdd: (texto: string) => void }) {
  const dit = useDitado();
  const [texto, setTexto] = useState("");
  const [checando, setChecando] = useState(false);
  const [aviso, setAviso] = useState<{ veredito: string; explicacao: string } | null>(null);
  const [erro, setErro] = useState("");
  const valor = dit.gravando ? (dit.transcricao + (dit.parcial ? (dit.transcricao ? " " : "") + dit.parcial : "")) : texto;

  function micToggle() {
    if (dit.gravando) { dit.parar(); setTexto((dit.transcricao + " " + dit.parcial).replace(/\s+/g, " ").trim()); }
    else { setErro(""); setAviso(null); dit.setTranscricao(texto); dit.setParcial(""); dit.iniciar(); }
  }

  async function verificar() {
    const nova = (dit.gravando ? (dit.transcricao + " " + dit.parcial) : texto).replace(/\s+/g, " ").trim();
    if (nova.length < 3) { setErro("Escreva ou fale a diretriz."); return; }
    if (dit.gravando) dit.parar();
    setChecando(true); setErro(""); setAviso(null);
    try {
      const r = await fetch("/api/ia-diretriz-validar", {
        method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ nova, existentes }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      if (d.veredito === "ok") { onAdd(nova); setTexto(""); dit.setTranscricao(""); dit.setParcial(""); }
      else setAviso({ veredito: d.veredito, explicacao: d.explicacao || "" });
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao validar."); }
    finally { setChecando(false); }
  }

  function adicionarMesmoAssim() {
    const nova = valor.replace(/\s+/g, " ").trim();
    if (nova.length < 3) return;
    onAdd(nova); setTexto(""); dit.setTranscricao(""); dit.setParcial(""); setAviso(null);
  }

  return (
    <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-900/10 p-3 space-y-2">
      <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">➕ Nova diretriz</div>
      <div className="flex gap-2 items-start">
        <button type="button" onClick={micToggle} disabled={checando} title={dit.gravando ? "Parar" : "Ditar por voz"}
          className={`shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center text-lg ${dit.gravando ? "border-rose-400 bg-rose-50 dark:bg-rose-900/20 text-rose-600" : "border-gray-300 dark:border-gray-700 text-gray-500 hover:bg-white dark:hover:bg-gray-800"}`}>{dit.gravando ? "⏹️" : "🎙️"}</button>
        <textarea value={valor} onChange={e => { setTexto(e.target.value); if (dit.gravando) dit.parar(); }} rows={2} disabled={checando}
          placeholder="Ex.: A IA não pode dar orientação jurídica que não esteja documentada."
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
      </div>
      {dit.gravando && <div className="text-[11px] text-rose-600 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse" /> Ouvindo…</div>}
      {(erro || dit.erroMic) && <div className="text-[11px] text-rose-600">{erro || dit.erroMic}</div>}
      {aviso && (
        <div className={`rounded-lg px-3 py-2 text-sm ${aviso.veredito === "contradiz" ? "bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800" : "bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800"}`}>
          <div className="font-semibold mb-0.5">{aviso.veredito === "contradiz" ? "⚠️ Contradiz uma diretriz existente" : "↔️ Parece redundante"}</div>
          <div className="text-[13px]">{aviso.explicacao}</div>
          <div className="flex gap-2 justify-end mt-2">
            <button type="button" onClick={() => setAviso(null)} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-600">Revisar texto</button>
            <button type="button" onClick={adicionarMesmoAssim} className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900">Adicionar mesmo assim</button>
          </div>
        </div>
      )}
      {!aviso && (
        <div className="flex justify-end">
          <Button onClick={verificar} disabled={checando || valor.trim().length < 3}>{checando ? "Verificando…" : "Verificar e adicionar"}</Button>
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${active ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>{children}</button>
  );
}

function ReplicarModal({ blocos, restaurantes, pessoaId, onClose }: {
  blocos: DiretrizBloco[]; restaurantes: { id: string; nome: string }[]; pessoaId: string; onClose: () => void;
}) {
  const [sel, setSel] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const toggle = (id: string) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  async function copiar() {
    if (sel.length === 0) return;
    setSalvando(true);
    try {
      const now = new Date().toISOString();
      await Promise.all(sel.map(id => setDoc(doc(db, "iaConfig", id), sanitizeForFirestore({
        restaurantId: id, diretrizesBlocos: blocos, diretrizes: juntarBlocos(blocos), atualizadoEm: now, atualizadoPor: pessoaId,
      }), { merge: true })));
      alert(`Diretrizes copiadas para ${sel.length} empresa(s).`);
      onClose();
    } catch (e) { alert("Erro ao copiar: " + (e instanceof Error ? e.message : "?")); }
    finally { setSalvando(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md p-5 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">📑 Copiar diretrizes</h2>
        <p className="text-xs text-gray-500 mt-1 mb-3">Os {blocos.length} blocos atuais vão substituir as diretrizes das empresas marcadas.</p>
        {restaurantes.length === 0 ? (
          <div className="text-sm text-gray-500 py-4 text-center">Você não tem outras empresas pra copiar.</div>
        ) : (
          <div className="space-y-1.5 mb-4">
            {restaurantes.map(r => (
              <label key={r.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
                <input type="checkbox" checked={sel.includes(r.id)} onChange={() => toggle(r.id)} />{r.nome}
              </label>
            ))}
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={copiar} disabled={salvando || sel.length === 0}>{salvando ? "Copiando…" : `Copiar para ${sel.length || ""}`}</Button>
        </div>
      </div>
    </div>
  );
}
