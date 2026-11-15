// ════════════════════════════════════════════════════════════════════════════
//  Etiqueta livre — editor de etiquetas avulsas (identificação de coisas
//  diversas). Modelos salvos e editáveis, com texto em vários tamanhos, campos
//  que o operador preenche na hora de imprimir, e logos. NÃO rastreada (não
//  entra no controle de validades) — é só desenho + impressão.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Tag, Trash2, ChevronUp, ChevronDown, Plus, Printer, Pencil, Image as ImageIcon, Home } from "lucide-react";
import { Button } from "../../core/ui/Button";
import { desenharEtiquetaLivre, larguraPx, type ElementoLivre, type Bobina } from "../../core/impressao/etiquetaTermica";
import { imprimirEtiquetas, destinoSalvo, noAppSunmi, type Destino } from "../../core/impressao/impressora";

const BOBINAS: Record<string, Bobina> = {
  "58x40": { larguraMm: 58, alturaMm: 40 }, "55x55": { larguraMm: 55, alturaMm: 55 },
  "58x60": { larguraMm: 58, alturaMm: 60 }, "60x40": { larguraMm: 60, alturaMm: 40 },
  "60x60": { larguraMm: 60, alturaMm: 60 }, "100x50": { larguraMm: 100, alturaMm: 50 }, "100x100": { larguraMm: 100, alturaMm: 100 },
};
function bobinaAtual(): { bobina: Bobina; largura: number } {
  let id = "58x40"; try { id = localStorage.getItem("etiq_bobina") || "58x40"; } catch { /* */ }
  const bobina = BOBINAS[id] || BOBINAS["58x40"];
  return { bobina, largura: larguraPx(bobina, noAppSunmi()) };
}

type Tam = "p" | "m" | "g" | "gg";
const TAM_LABEL: Record<Tam, string> = { p: "P", m: "M", g: "G", gg: "GG" };
export type ElemCampo = { tipo: "campo"; rotulo: string; chave: string; tam: Tam; negrito?: boolean; centro?: boolean; data?: boolean };
export type ElemTemplate = ElementoLivre | ElemCampo;
export type EtiquetaLivreTemplate = { id: string; restaurantIds: string[]; nome: string; bobinaId?: string | null; elementos: ElemTemplate[]; criadoEm: string };
export type LogoEtiqueta = { id: string; restaurantIds: string[]; nome: string; url: string; criadoEm: string };

const novaChave = () => `c_${Math.random().toString(36).slice(2, 7)}`;

// Logo guardado como imagem reduzida (data URL) no próprio doc — sem Storage,
// sem CORS (que tainta o canvas na hora de imprimir). Reduz pra até `maxW` px.
function arquivoParaDataUrl(file: File, maxW: number): Promise<string> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const esc = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * esc), h = Math.round(img.height * esc);
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const ctx = c.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        res(c.toDataURL("image/png"));
      } catch (e) { rej(e); }
    };
    img.onerror = rej; img.src = url;
  });
}
const fmtData = (iso: string) => { const [a, m, d] = iso.split("-"); return d && m && a ? `${d}/${m}/${a}` : iso; };

function elementosParaImpressao(elementos: ElemTemplate[], valores: Record<string, string>): ElementoLivre[] {
  return elementos.map((e): ElementoLivre => {
    if (e.tipo === "campo") {
      const bruto = valores[e.chave] || "";
      const texto = e.data && bruto ? fmtData(bruto) : bruto;
      return { tipo: "texto", texto, tam: e.tam, negrito: e.negrito, centro: e.centro };
    }
    return e;
  });
}

export function EtiquetaLivreScreen({ rids, podeEditar, naMaquininha, onSair }: {
  rids: string[]; podeEditar: boolean; naMaquininha?: boolean; onSair: () => void;
}) {
  const { bobina, largura } = useMemo(() => bobinaAtual(), []);
  const [templates, setTemplates] = useState<EtiquetaLivreTemplate[]>([]);
  const [logos, setLogos] = useState<LogoEtiqueta[]>([]);
  const [modo, setModo] = useState<"lista" | "editar" | "imprimir">("lista");
  const [edit, setEdit] = useState<EtiquetaLivreTemplate | null>(null);
  const ridsKey = rids.join(",");

  useEffect(() => {
    if (rids.length === 0) return;
    const subs = [
      onSnapshot(query(collection(db, "etiquetaLivreTemplates"), where("restaurantIds", "array-contains-any", rids)), (s) => setTemplates(s.docs.map((d) => ({ id: d.id, ...d.data() }) as EtiquetaLivreTemplate)), () => setTemplates([])),
      onSnapshot(query(collection(db, "etiquetaLivreLogos"), where("restaurantIds", "array-contains-any", rids)), (s) => setLogos(s.docs.map((d) => ({ id: d.id, ...d.data() }) as LogoEtiqueta)), () => setLogos([])),
    ];
    return () => subs.forEach((u) => u());
  }, [ridsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (modo === "editar") return <EditorTemplate template={edit} rids={rids} bobina={bobina} largura={largura} logos={logos} onSubirLogo={subirLogo} onVoltar={() => setModo("lista")} onSalvar={salvarTemplate} />;
  if (modo === "imprimir" && edit) return <ImprimirTemplate template={edit} bobina={bobina} largura={largura} onVoltar={() => setModo("lista")} />;

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      {naMaquininha && <button type="button" onClick={onSair} className="w-full mb-1 h-12 rounded-xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-200 font-semibold inline-flex items-center justify-center gap-2 active:scale-[.99]"><Home size={18} /> Retornar ao início</button>}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-500 max-w-md">Etiquetas avulsas (identificação de coisas diversas). Monte um modelo, salve e reuse. Não entra no controle de validades.</p>
        {podeEditar && <Button size="sm" onClick={() => { setEdit(null); setModo("editar"); }}><Plus size={15} /> Novo modelo</Button>}
      </div>
      {templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">Nenhum modelo ainda. {podeEditar ? "Crie o primeiro." : ""}</div>
      ) : (
        <div className="space-y-2">
          {templates.slice().sort((a, b) => a.nome.localeCompare(b.nome)).map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
              <button type="button" onClick={() => { setEdit(t); setModo("imprimir"); }} className="min-w-0 flex-1 text-left inline-flex items-center gap-2">
                <Tag size={18} className="shrink-0 text-indigo-500" />
                <span className="truncate font-medium text-gray-900 dark:text-gray-100">{t.nome}</span>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => { setEdit(t); setModo("imprimir"); }} className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold inline-flex items-center gap-1.5"><Printer size={15} /> Imprimir</button>
                {podeEditar && <button type="button" onClick={() => { setEdit(t); setModo("editar"); }} className="h-9 w-9 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 inline-flex items-center justify-center"><Pencil size={15} /></button>}
                {podeEditar && <button type="button" onClick={() => { if (confirm(`Excluir o modelo "${t.nome}"?`)) void deleteDoc(doc(db, "etiquetaLivreTemplates", t.id)); }} className="h-9 w-9 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-300 hover:text-rose-600 inline-flex items-center justify-center"><Trash2 size={15} /></button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  async function subirLogo(file: File): Promise<LogoEtiqueta | null> {
    try {
      const url = await arquivoParaDataUrl(file, 384);
      const nome = file.name.replace(/\.[^.]+$/, "");
      const ref = await addDoc(collection(db, "etiquetaLivreLogos"), { restaurantIds: rids, nome, url, criadoEm: new Date().toISOString() });
      return { id: ref.id, restaurantIds: rids, nome, url, criadoEm: new Date().toISOString() };
    } catch { return null; }
  }

  async function salvarTemplate(t: { id?: string; nome: string; elementos: ElemTemplate[] }) {
    if (t.id) await updateDoc(doc(db, "etiquetaLivreTemplates", t.id), { nome: t.nome, elementos: t.elementos });
    else await addDoc(collection(db, "etiquetaLivreTemplates"), { restaurantIds: rids, nome: t.nome, elementos: t.elementos, criadoEm: new Date().toISOString() });
    setModo("lista");
  }
}

// ── Editor de modelo ──────────────────────────────────────────────────────────
function EditorTemplate({ template, bobina, largura, logos, onSubirLogo, onVoltar, onSalvar }: {
  template: EtiquetaLivreTemplate | null; rids: string[]; bobina: Bobina; largura: number; logos: LogoEtiqueta[];
  onSubirLogo: (f: File) => Promise<LogoEtiqueta | null>; onVoltar: () => void;
  onSalvar: (t: { id?: string; nome: string; elementos: ElemTemplate[] }) => Promise<void>;
}) {
  const [nome, setNome] = useState(template?.nome || "");
  const [els, setEls] = useState<ElemTemplate[]>(template?.elementos || [{ tipo: "texto", texto: "Novo texto", tam: "g" }]);
  const [preview, setPreview] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let vivo = true;
    const amostra = elementosParaImpressao(els, Object.fromEntries(els.flatMap((e) => e.tipo === "campo" ? [[e.chave, `[${e.rotulo || "campo"}]`]] : [])));
    desenharEtiquetaLivre(amostra, bobina, largura).then((c) => { if (vivo) setPreview(c.toDataURL("image/png")); }).catch(() => {});
    return () => { vivo = false; };
  }, [els, bobina, largura]);

  const upd = (i: number, patch: Partial<ElemTemplate>) => setEls((p) => p.map((e, j) => (j === i ? { ...e, ...patch } as ElemTemplate : e)));
  const mover = (i: number, d: number) => setEls((p) => { const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const remover = (i: number) => setEls((p) => p.filter((_, j) => j !== i));
  const add = (e: ElemTemplate) => setEls((p) => [...p, e]);

  async function salvar() {
    if (!nome.trim()) return;
    setSalvando(true);
    try { await onSalvar({ id: template?.id, nome: nome.trim(), elementos: els }); } finally { setSalvando(false); }
  }

  const inp = "w-full h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100";
  const botTam = (e: ElemTemplate & { tam?: Tam }, i: number) => e.tam && (
    <div className="flex gap-1">{(["p", "m", "g", "gg"] as Tam[]).map((t) => <button key={t} type="button" onClick={() => upd(i, { tam: t } as Partial<ElemTemplate>)} className={`h-8 w-8 rounded text-xs font-bold ${e.tam === t ? "bg-indigo-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"}`}>{TAM_LABEL[t]}</button>)}</div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onVoltar} className="text-sm text-gray-500">← Voltar</button>
        <Button size="sm" onClick={() => void salvar()} disabled={salvando || !nome.trim()}>{salvando ? "Salvando…" : "Salvar modelo"}</Button>
      </div>
      <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do modelo (ex.: Identificação de caixa)" className={`${inp} h-11 font-semibold`} />

      {preview && <div className="flex justify-center py-2"><img src={preview} alt="prévia" className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white" style={{ width: Math.min(300, largura) }} /></div>}

      <div className="space-y-2">
        {els.map((e, i) => (
          <div key={i} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{e.tipo === "texto" ? "Texto" : e.tipo === "campo" ? "Campo (preenche na hora)" : e.tipo === "logo" ? "Logo" : e.tipo === "fio" ? "Linha" : "Espaço"}</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => mover(i, -1)} className="h-8 w-8 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 inline-flex items-center justify-center"><ChevronUp size={16} /></button>
                <button type="button" onClick={() => mover(i, 1)} className="h-8 w-8 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 inline-flex items-center justify-center"><ChevronDown size={16} /></button>
                <button type="button" onClick={() => remover(i)} className="h-8 w-8 rounded text-gray-300 hover:text-rose-600 inline-flex items-center justify-center"><Trash2 size={15} /></button>
              </div>
            </div>
            {e.tipo === "texto" && <textarea value={e.texto} onChange={(ev) => upd(i, { texto: ev.target.value })} rows={1} placeholder="Texto fixo" className={`${inp} h-auto py-2`} />}
            {e.tipo === "campo" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input value={e.rotulo} onChange={(ev) => upd(i, { rotulo: ev.target.value })} placeholder="Nome do campo (ex.: Conteúdo)" className={inp} />
                <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300"><input type="checkbox" checked={!!e.data} onChange={(ev) => upd(i, { data: ev.target.checked } as Partial<ElemTemplate>)} /> É data</label>
              </div>
            )}
            {e.tipo === "logo" && (
              <div className="flex flex-wrap gap-1.5">
                {logos.length === 0 && <span className="text-xs text-gray-400">Nenhuma logo. Suba uma em “+ Logo”.</span>}
                {logos.map((l) => <button key={l.id} type="button" onClick={() => upd(i, { url: l.url } as Partial<ElemTemplate>)} className={`h-12 px-1 rounded border ${e.url === l.url ? "border-indigo-500 ring-1 ring-indigo-400" : "border-gray-200 dark:border-gray-700"} bg-white`}><img src={l.url} alt={l.nome} className="h-10 object-contain" /></button>)}
              </div>
            )}
            {(e.tipo === "texto" || e.tipo === "campo") && (
              <div className="flex items-center gap-3 flex-wrap">
                {botTam(e, i)}
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={!!e.negrito} onChange={(ev) => upd(i, { negrito: ev.target.checked } as Partial<ElemTemplate>)} /> Negrito</label>
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={!!e.centro} onChange={(ev) => upd(i, { centro: ev.target.checked } as Partial<ElemTemplate>)} /> Centralizado</label>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => add({ tipo: "texto", texto: "", tam: "m" })}><Plus size={14} /> Texto</Button>
        <Button size="sm" variant="secondary" onClick={() => add({ tipo: "campo", rotulo: "", chave: novaChave(), tam: "m" })}><Plus size={14} /> Campo</Button>
        <Button size="sm" variant="secondary" onClick={() => add({ tipo: "logo", url: "", alturaMm: 12, centro: true })}><ImageIcon size={14} /> Logo</Button>
        <Button size="sm" variant="secondary" onClick={() => add({ tipo: "fio" })}><Plus size={14} /> Linha</Button>
        <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}><ImageIcon size={14} /> Subir logo</Button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (ev) => { const f = ev.target.files?.[0]; ev.target.value = ""; if (f) { const l = await onSubirLogo(f); if (l) add({ tipo: "logo", url: l.url, alturaMm: 12, centro: true }); } }} />
      </div>
    </div>
  );
}

// ── Imprimir (preenche os campos) ─────────────────────────────────────────────
function ImprimirTemplate({ template, bobina, largura, onVoltar }: {
  template: EtiquetaLivreTemplate; bobina: Bobina; largura: number; onVoltar: () => void;
}) {
  const campos = useMemo(() => template.elementos.filter((e): e is ElemCampo => e.tipo === "campo"), [template]);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [copias, setCopias] = useState(1);
  const [preview, setPreview] = useState<string | null>(null);
  const [imprimindo, setImprimindo] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    const els = elementosParaImpressao(template.elementos, Object.fromEntries(campos.map((c) => [c.chave, valores[c.chave] || `[${c.rotulo}]`])));
    desenharEtiquetaLivre(els, bobina, largura).then((c) => { if (vivo) setPreview(c.toDataURL("image/png")); }).catch(() => {});
    return () => { vivo = false; };
  }, [template, valores, bobina, largura, campos]);

  async function imprimir() {
    setImprimindo(true); setMsg(null);
    try {
      const els = elementosParaImpressao(template.elementos, valores);
      const canvases = await Promise.all(Array.from({ length: copias }, () => desenharEtiquetaLivre(els, bobina, largura)));
      const r = await imprimirEtiquetas(canvases, bobina, destinoSalvo() as Destino);
      if (!r.ok) { setMsg({ ok: false, texto: r.erro || "Falha ao imprimir." }); return; }
      setMsg({ ok: true, texto: `${copias > 1 ? `${copias} etiquetas` : "Etiqueta"} impressa${copias > 1 ? "s" : ""}.` });
    } finally { setImprimindo(false); }
  }

  const inp = "w-full h-11 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100";
  return (
    <div className="max-w-md mx-auto space-y-3">
      <button type="button" onClick={onVoltar} className="text-sm text-gray-500">← Voltar</button>
      <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{template.nome}</h2>
      {preview && <div className="flex justify-center py-1"><img src={preview} alt="prévia" className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white" style={{ width: Math.min(280, largura) }} /></div>}
      {campos.map((c) => (
        <div key={c.chave}>
          <label className="text-xs text-gray-500 block mb-1">{c.rotulo || "Campo"}</label>
          <input type={c.data ? "date" : "text"} value={valores[c.chave] || ""} onChange={(e) => setValores((p) => ({ ...p, [c.chave]: e.target.value }))} className={inp} />
        </div>
      ))}
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-600 dark:text-gray-300">Cópias</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setCopias((c) => Math.max(1, c - 1))} className="h-9 w-9 rounded-lg border border-gray-200 dark:border-gray-700 text-lg">–</button>
          <span className="w-6 text-center font-semibold tabular-nums">{copias}</span>
          <button type="button" onClick={() => setCopias((c) => Math.min(20, c + 1))} className="h-9 w-9 rounded-lg border border-gray-200 dark:border-gray-700 text-lg">+</button>
        </div>
      </div>
      {msg && <div className={`text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600"}`}>{msg.texto}</div>}
      <Button onClick={() => void imprimir()} disabled={imprimindo} className="w-full"><Printer size={16} /> {imprimindo ? "Imprimindo…" : "Imprimir"}</Button>
    </div>
  );
}
