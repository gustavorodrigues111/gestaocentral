// Configurações do Cardápio (por restaurante): fontes (título + corpo), arte
// (PNG de capa e de miolo) e colunas padrão. Tudo salvo no layout COMPARTILHADO
// (cardapioEstruturado.layout), valendo pra todos os cardápios do restaurante.
import { useEffect, useRef, useState } from "react";
import { doc, getDoc, updateDoc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { FontePicker, AdicionarFonteModal } from "../sites/shared/FontePicker";
import { opcoesFonte, resolverFonte, urlsCss2 } from "../sites/shared/cardapioFontes";
import type { CardapioEstruturado, CardapioLayout } from "../../core/types";

export function CardapioConfig({ rid, podeEditar, atualizadoPor }: { rid: string; podeEditar: boolean; atualizadoPor?: string }) {
  const [lay, setLay] = useState<CardapioLayout>({ fonteTitulos: "dm-serif-display", fonteCorpo: "inter", fontesCustom: [] });
  const [addFonte, setAddFonte] = useState(false);
  const [estado, setEstado] = useState<"" | "salvando" | "salvo">("");
  const [subindo, setSubindo] = useState<"capa" | "miolo" | "">("");
  const [erroArte, setErroArte] = useState("");

  useEffect(() => {
    void getDoc(doc(db, "cardapioEstruturado", rid)).then((s) => {
      const d = s.exists() ? (s.data() as CardapioEstruturado) : null;
      if (d?.layout) setLay({ ...d.layout, fonteTitulos: d.layout.fonteTitulos || "dm-serif-display", fonteCorpo: d.layout.fonteCorpo || "inter", fontesCustom: d.layout.fontesCustom || [] });
    });
  }, [rid]);

  // Carrega o catálogo (curadas + custom) só enquanto a config está aberta — pros
  // previews dos dropdowns. (O designer do PDF NÃO carrega isso.)
  useEffect(() => {
    const links = urlsCss2(opcoesFonte(lay.fontesCustom || [])).map((href) => {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = href;
      document.head.appendChild(l);
      return l;
    });
    return () => links.forEach((l) => l.remove());
  }, [lay.fontesCustom]);

  // Salva um patch no layout COMPARTILHADO (campos pontuais via dot-path).
  async function salvar(patch: Partial<CardapioLayout>) {
    const next = { ...lay, ...patch };
    setLay(next);
    if (!podeEditar) return;
    setEstado("salvando");
    const ref = doc(db, "cardapioEstruturado", rid);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const dotted = Object.fromEntries(Object.entries(patch).map(([k, v]) => [`layout.${k}`, v]));
        await updateDoc(ref, sanitizeForFirestore(dotted));
      } else {
        await setDoc(ref, sanitizeForFirestore({ id: rid, restaurantId: rid, layout: next, atualizadoEm: new Date().toISOString(), atualizadoPor }), { merge: true });
      }
      setEstado("salvo"); setTimeout(() => setEstado(""), 1800);
    } catch { setEstado(""); }
  }

  async function subirArte(tipo: "capa" | "miolo", file: File) {
    if (!podeEditar) return;
    setErroArte(""); setSubindo(tipo);
    try {
      const { ref, uploadBytes, getDownloadURL } = await import("firebase/storage");
      const { storage } = await import("../../core/firebase/config");
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const r = ref(storage, `cardapios/${rid}/${tipo}-${Date.now()}.${ext}`);
      await uploadBytes(r, file, { contentType: file.type });
      const url = await getDownloadURL(r);
      await salvar(tipo === "capa" ? { capaUrl: url } : { mioloUrl: url });
    } catch (e) {
      setErroArte(`Falha ao enviar a arte: ${e instanceof Error ? e.message : "erro desconhecido"}`);
    } finally { setSubindo(""); }
  }

  const fTit = resolverFonte(lay.fonteTitulos, lay.fontesCustom || []);
  const fCorpo = resolverFonte(lay.fonteCorpo, lay.fontesCustom || []);
  const colsPadrao = lay.colsPadrao ?? 2;

  return (
    <div className="max-w-xl space-y-6">
      {/* Fontes */}
      <section className="space-y-3">
        <div>
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Fontes do cardápio</h3>
          <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">Defina uma vez. Vale para todos os cardápios — só muda num específico se marcar "formatar diferente" no preview dele.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <FontePicker label="Fonte dos títulos / seções" value={lay.fonteTitulos || ""} custom={lay.fontesCustom || []} onChange={(id) => void salvar({ fonteTitulos: id })} onAdicionar={() => setAddFonte(true)} />
          <FontePicker label="Fonte do corpo (pratos / descrições)" value={lay.fonteCorpo || ""} custom={lay.fontesCustom || []} onChange={(id) => void salvar({ fonteCorpo: id })} onAdicionar={() => setAddFonte(true)} />
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-5 bg-white dark:bg-gray-900/40">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">Amostra</div>
          <div style={{ fontFamily: fTit.cssFamily, fontSize: 24, color: "#1d3c4b", fontWeight: 600 }}>Entradas</div>
          <div style={{ fontFamily: fCorpo.cssFamily, fontSize: 15, fontWeight: 600, color: "#222", marginTop: 8 }}>Bolinho de bacalhau</div>
          <div style={{ fontFamily: fCorpo.cssFamily, fontSize: 13, color: "#777", marginTop: 2 }}>Crocante por fora, cremoso por dentro, com aioli de limão-siciliano.</div>
        </div>
      </section>

      {/* Arte (PNG) */}
      <section className="space-y-3 pt-2 border-t border-gray-100 dark:border-gray-800">
        <div>
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Arte do cardápio</h3>
          <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">PNG de fundo. <strong>Capa</strong> = página 1 (com o título por cima). <strong>Miolo</strong> = fundo das demais páginas. Proporção A4 retrato.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <ArteUpload titulo="Capa (página 1)" url={lay.capaUrl} subindo={subindo === "capa"} podeEditar={podeEditar}
            onPick={(f) => void subirArte("capa", f)} onRemover={() => void salvar({ capaUrl: "" })} />
          <ArteUpload titulo="Miolo (demais páginas)" url={lay.mioloUrl} subindo={subindo === "miolo"} podeEditar={podeEditar}
            onPick={(f) => void subirArte("miolo", f)} onRemover={() => void salvar({ mioloUrl: "" })} />
        </div>
        {erroArte && <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5">⚠ {erroArte}</div>}
      </section>

      {/* Colunas */}
      <section className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
        <div>
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Colunas padrão</h3>
          <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">Nº de colunas das páginas de conteúdo. Dá pra mudar página a página no preview de cada cardápio.</p>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 w-max">
          {[1, 2, 3].map((n) => (
            <button key={n} type="button" disabled={!podeEditar} onClick={() => void salvar({ colsPadrao: n })}
              className={`px-4 py-1.5 text-sm font-medium ${colsPadrao === n ? "bg-indigo-600 text-white" : "text-gray-600 dark:text-gray-300"}`}>{n} {n === 1 ? "coluna" : "colunas"}</button>
          ))}
        </div>
      </section>

      <div className="text-[12px] h-4">
        {estado === "salvando" ? <span className="text-gray-400">salvando…</span> : estado === "salvo" ? <span className="text-emerald-600 dark:text-emerald-400 font-medium">✓ Salvo</span> : null}
      </div>

      {addFonte && <AdicionarFonteModal onClose={() => setAddFonte(false)} onAdd={(f) => { void salvar({ fontesCustom: [...new Set([...(lay.fontesCustom || []), f])] }); setAddFonte(false); }} />}
    </div>
  );
}

function ArteUpload({ titulo, url, subindo, podeEditar, onPick, onRemover }: {
  titulo: string; url?: string; subindo: boolean; podeEditar: boolean; onPick: (f: File) => void; onRemover: () => void;
}) {
  const inp = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3 space-y-2">
      <div className="text-xs font-semibold text-gray-600 dark:text-gray-400">{titulo}</div>
      <div className="aspect-[1/1.414] w-full rounded-lg border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 overflow-hidden flex items-center justify-center">
        {url ? <img src={url} alt={titulo} className="w-full h-full object-contain" /> : <span className="text-[11px] text-gray-400">sem arte</span>}
      </div>
      <input ref={inp} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.currentTarget.value = ""; }} />
      <div className="flex items-center gap-2">
        <button type="button" disabled={!podeEditar || subindo} onClick={() => inp.current?.click()}
          className="text-[12px] px-2.5 py-1 rounded-lg bg-indigo-600 text-white disabled:opacity-50">{subindo ? "enviando…" : url ? "Trocar" : "Enviar PNG"}</button>
        {url && podeEditar && <button type="button" onClick={onRemover} className="text-[12px] text-rose-600 hover:underline">remover</button>}
      </div>
    </div>
  );
}
