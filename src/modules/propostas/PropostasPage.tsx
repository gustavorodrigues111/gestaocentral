// ════════════════════════════════════════════════════════════════════════════
//  Propostas (master) — gere todas as propostas comerciais e seus prazos.
//  Edita cliente/logo, URL (slug), senha, validade, valores, escopo e termos.
//  A página pública proposta.planejamento.app/<slug> lê o doc e renderiza.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import {
  type Proposta, propostaJojo, propostaStatus, URL_BASE_PROPOSTA,
} from "./tipos";

const lbl = "text-xs font-semibold text-gray-600 dark:text-gray-400";
const ta = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";

export function PropostasPage() {
  const { pessoa: me } = useAuth();
  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [edit, setEdit] = useState<Proposta | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onSnapshot(collection(db, "propostas"), s => {
      setPropostas(s.docs.map(d => ({ ...(d.data() as Proposta), id: d.id })));
      setLoading(false);
    }, () => setLoading(false));
  }, []);

  if (!me?.isMaster) return <div className="max-w-3xl mx-auto p-8 text-center text-gray-500">🔒 Só o master acessa Propostas.</div>;

  if (edit) return <EditorProposta proposta={edit} onClose={() => setEdit(null)} onSaved={() => setEdit(null)} />;

  const jojoExiste = propostas.some(p => p.slug === "jojo" || p.id === "jojo");
  const ordenadas = [...propostas].sort((a, b) => (b.atualizadoEm || "").localeCompare(a.atualizadoEm || ""));

  async function importarJojo() {
    const j = propostaJojo();
    await setDoc(doc(db, "propostas", "jojo"), sanitizeForFirestore({ ...j, criadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString() }));
  }
  function nova() {
    const base = propostaJojo();
    setEdit({ ...base, id: "", slug: "", clienteNome: "", logo: "none", senha: "", ativo: true, emissao: new Date().toISOString().slice(0, 10), criadoEm: undefined, atualizadoEm: undefined });
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <header className="mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">📄 Propostas</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Gerencie as propostas comerciais, prazos e a página pública de cada uma.</p>
        </div>
        <div className="flex gap-2">
          {!jojoExiste && <Button variant="secondary" onClick={() => void importarJojo()}>⬇ Importar proposta do Jojo</Button>}
          <Button onClick={nova}>＋ Nova proposta</Button>
        </div>
      </header>

      {loading ? (
        <div className="text-sm text-gray-400 py-10 text-center">Carregando…</div>
      ) : ordenadas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
          Nenhuma proposta ainda. Clique em <strong>Importar proposta do Jojo</strong> pra começar com a que já criamos, ou <strong>Nova proposta</strong>.
        </div>
      ) : (
        <div className="space-y-2">
          {ordenadas.map(p => {
            const st = propostaStatus(p);
            const url = `${URL_BASE_PROPOSTA}/${p.slug}`;
            return (
              <div key={p.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 flex items-center gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{p.clienteNome || "(sem cliente)"}</div>
                  <div className="text-[12px] text-gray-500 dark:text-gray-400 truncate">{url}{p.senha ? ` · 🔑 ${p.senha}` : ""}</div>
                </div>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${st.expirada ? "bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300" : !p.ativo ? "bg-gray-100 text-gray-500 dark:bg-gray-800" : st.diasRestantes <= 2 ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"}`}>{st.label}</span>
                <button type="button" onClick={() => { navigator.clipboard?.writeText(url); }} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800" title="Copiar link">🔗 Copiar</button>
                <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">Abrir ↗</a>
                <button type="button" onClick={() => setEdit(p)} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20">Editar</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────────
function EditorProposta({ proposta, onClose, onSaved }: { proposta: Proposta; onClose: () => void; onSaved: () => void }) {
  const [p, setP] = useState<Proposta>(proposta);
  const [salvando, setSalvando] = useState(false);
  const [err, setErr] = useState("");
  const set = <K extends keyof Proposta>(k: K, v: Proposta[K]) => setP(s => ({ ...s, [k]: v }));
  const setSec = <S extends keyof Proposta>(sec: S, patch: Partial<Proposta[S]>) => setP(s => ({ ...s, [sec]: { ...(s[sec] as object), ...patch } }));

  const url = useMemo(() => `${URL_BASE_PROPOSTA}/${p.slug || "…"}`, [p.slug]);

  async function salvar() {
    const slug = (p.slug || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!p.clienteNome.trim()) { setErr("Informe o nome do cliente."); return; }
    if (!slug) { setErr("Informe o slug da URL (ex: jojo)."); return; }
    setErr(""); setSalvando(true);
    try {
      const now = new Date().toISOString();
      const payload = sanitizeForFirestore({ ...p, slug, atualizadoEm: now, criadoEm: p.criadoEm || now });
      const id = p.id || slug;
      await setDoc(doc(db, "propostas", id), payload, { merge: false });
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : "Falha ao salvar."); setSalvando(false); }
  }
  async function excluir() {
    if (!p.id) { onClose(); return; }
    if (!confirm(`Excluir a proposta de ${p.clienteNome}? A página pública some.`)) return;
    await deleteDoc(doc(db, "propostas", p.id));
    onSaved();
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      <header className="mb-4 flex items-center gap-2">
        <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 text-sm">← Voltar</button>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{p.id ? "Editar proposta" : "Nova proposta"}</h1>
        <a href={url} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-indigo-600 dark:text-indigo-400 hover:underline">{url} ↗</a>
      </header>

      <div className="space-y-5">
        <Sec titulo="Identificação">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Cliente *" value={p.clienteNome} onChange={e => set("clienteNome", e.target.value)} />
            <Input label="Slug da URL *" value={p.slug} onChange={e => set("slug", e.target.value)} placeholder="jojo" />
            <div className="flex flex-col gap-1"><label className={lbl}>Logomarca do cliente</label>
              <select value={p.logo} onChange={e => set("logo", e.target.value as Proposta["logo"])} className={ta}><option value="none">Nenhuma</option><option value="jojo">Jojo Ramen (tigela)</option></select></div>
            <Input label="Palavra-chave (vazio = sem trava)" value={p.senha} onChange={e => set("senha", e.target.value)} />
            <Input label="Emissão" type="date" value={p.emissao} onChange={e => set("emissao", e.target.value)} />
            <Input label="Validade (dias)" type="number" value={p.validadeDias} onChange={e => set("validadeDias", Number(e.target.value) || 0)} />
            <Input label="Apresentado por" value={p.apresentadoPor} onChange={e => set("apresentadoPor", e.target.value)} className="sm:col-span-2" />
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={p.ativo} onChange={e => set("ativo", e.target.checked)} /> Publicada (desmarque pra tirar do ar sem excluir)</label>
          </div>
        </Sec>

        <Sec titulo="Capa">
          <Input label="Eyebrow" value={p.eyebrow} onChange={e => set("eyebrow", e.target.value)} />
          <Input label="Título" value={p.titulo} onChange={e => set("titulo", e.target.value)} />
          <Campo label="Lead" v={p.lead} set={v => set("lead", v)} area />
          <Campo label="Faixa early buyer (pill) — vazio esconde" v={p.pill} set={v => set("pill", v)} />
        </Sec>

        <Sec titulo="Investimento (valores)">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Total (destaque)" value={p.investimento.total} onChange={e => setSec("investimento", { total: e.target.value })} />
            <Input label="Nota do total" value={p.investimento.totalNota} onChange={e => setSec("investimento", { totalNota: e.target.value })} />
            <Input label="Parcelas" value={p.investimento.parcelas} onChange={e => setSec("investimento", { parcelas: e.target.value })} />
            <Input label="Nota das parcelas" value={p.investimento.parcelasNota} onChange={e => setSec("investimento", { parcelasNota: e.target.value })} />
          </div>
          <Campo label="Callout (desconto/condição)" v={p.investimento.callout} set={v => setSec("investimento", { callout: v })} area />
          <Linhas titulo="Composição do investimento" campos={["item", "valor"]} rows={p.investimento.composicao} onChange={r => setSec("investimento", { composicao: r })} />
          <Campo label="Rodapé (horas etc)" v={p.investimento.rodape} set={v => setSec("investimento", { rodape: v })} area />
        </Sec>

        <Sec titulo="Continuidade">
          <Linhas titulo="Planos" campos={["titulo", "desc", "valor", "nota"]} rows={p.continuidade.planos} onChange={r => setSec("continuidade", { planos: r })} />
          <Campo label="Nota" v={p.continuidade.nota} set={v => setSec("continuidade", { nota: v })} area />
        </Sec>

        <Sec titulo="O que é / Frentes / Módulos">
          <Multi label="O que é — parágrafos (um por linha)" v={p.oquee.paragrafos} set={v => setSec("oquee", { paragrafos: v })} />
          <Linhas titulo="Frentes (cards A/B/C/D)" campos={["n", "titulo", "desc"]} rows={p.frentes.cards} onChange={r => setSec("frentes", { cards: r })} />
          <GruposModulos grupos={p.modulos.grupos} onChange={g => setSec("modulos", { grupos: g })} />
        </Sec>

        <Sec titulo="Fases / Entregáveis / Terceiros">
          <Linhas titulo="Fases (6)" campos={["when", "titulo", "desc"]} rows={p.fases.itens} onChange={r => setSec("fases", { itens: r })} />
          <Multi label="Você recebe (um por linha)" v={p.entregaveis.recebe} set={v => setSec("entregaveis", { recebe: v })} />
          <Multi label="Por conta do cliente (um por linha)" v={p.entregaveis.cliente} set={v => setSec("entregaveis", { cliente: v })} />
          <Linhas titulo="Custos de terceiros" campos={["servico", "oque", "estimativa"]} rows={p.terceiros.linhas} onChange={r => setSec("terceiros", { linhas: r })} />
        </Sec>

        <Sec titulo="Termos">
          <Linhas titulo="Termos do programa" campos={["t", "d"]} rows={p.termos.itens} onChange={r => setSec("termos", { itens: r })} />
        </Sec>

        {err && <div className="text-sm text-rose-600">{err}</div>}
        <div className="flex items-center justify-between gap-2 sticky bottom-0 bg-gradient-to-t from-white dark:from-gray-950 to-transparent py-3">
          <Button variant="ghost" onClick={excluir}>{p.id ? "Excluir" : "Cancelar"}</Button>
          <Button onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Salvar proposta"}</Button>
        </div>
      </div>
    </div>
  );
}

function Sec({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">{titulo}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
function Campo({ label, v, set, area }: { label: string; v: string; set: (v: string) => void; area?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <label className={lbl}>{label}</label>
      {area ? <textarea rows={3} value={v} onChange={e => set(e.target.value)} className={ta} /> : <input value={v} onChange={e => set(e.target.value)} className={ta} />}
    </div>
  );
}
function Multi({ label, v, set }: { label: string; v: string[]; set: (v: string[]) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className={lbl}>{label}</label>
      <textarea rows={Math.max(3, v.length + 1)} value={v.join("\n")} onChange={e => set(e.target.value.split("\n"))} className={ta} />
    </div>
  );
}
// Editor de linhas (array de objetos com campos de texto).
function Linhas<T extends Record<string, string | undefined>>({ titulo, campos, rows, onChange }: { titulo: string; campos: (keyof T & string)[]; rows: T[]; onChange: (r: T[]) => void }) {
  const upd = (i: number, k: string, val: string) => onChange(rows.map((r, j) => j === i ? { ...r, [k]: val } : r));
  const add = () => onChange([...rows, campos.reduce((a, c) => ({ ...a, [c]: "" }), {}) as T]);
  const del = (i: number) => onChange(rows.filter((_, j) => j !== i));
  return (
    <div className="flex flex-col gap-1.5">
      <label className={lbl}>{titulo}</label>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-1.5 items-start">
            <div className="flex-1 grid grid-cols-1 gap-1.5">
              {campos.map(c => (
                <input key={c} value={r[c] || ""} onChange={e => upd(i, c, e.target.value)} placeholder={c}
                  className="px-2.5 py-1.5 text-[13px] rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
              ))}
            </div>
            <button type="button" onClick={() => del(i)} className="text-rose-500 hover:text-rose-600 text-sm px-1 pt-1.5">✕</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={add} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline self-start mt-1">＋ adicionar</button>
    </div>
  );
}
function GruposModulos({ grupos, onChange }: { grupos: { titulo: string; itens: string[] }[]; onChange: (g: { titulo: string; itens: string[] }[]) => void }) {
  const upd = (i: number, patch: Partial<{ titulo: string; itens: string[] }>) => onChange(grupos.map((g, j) => j === i ? { ...g, ...patch } : g));
  return (
    <div className="flex flex-col gap-1.5">
      <label className={lbl}>Módulos (grupos)</label>
      <div className="space-y-2">
        {grupos.map((g, i) => (
          <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-800 p-2.5">
            <div className="flex gap-1.5 items-center mb-1.5">
              <input value={g.titulo} onChange={e => upd(i, { titulo: e.target.value })} placeholder="título do grupo" className="flex-1 px-2.5 py-1.5 text-[13px] font-semibold rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
              <button type="button" onClick={() => onChange(grupos.filter((_, j) => j !== i))} className="text-rose-500 text-sm px-1">✕</button>
            </div>
            <textarea rows={Math.max(2, g.itens.length + 1)} value={g.itens.join("\n")} onChange={e => upd(i, { itens: e.target.value.split("\n") })} placeholder="um item por linha" className={ta} />
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...grupos, { titulo: "", itens: [] }])} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline self-start mt-1">＋ grupo</button>
    </div>
  );
}
