// Designer interativo do PDF do cardápio: escolhe fontes (Google, com preview na
// própria fonte + adicionar qualquer família), regula tamanhos/espaçamentos e o
// título da capa, e vê o A4 ao vivo. O PDF é gerado do PRÓPRIO preview
// (html2canvas → jsPDF) — a fonte sai idêntica à da tela.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { opcoesFonte, resolverFonte, urlCss2, fonteCustom } from "./shared/cardapioFontes";
import type { CardapioLayout, SecaoCardapio } from "../../core/types";

const TEAL = "#1d3c4b";
const PAGE_W = 460, PAGE_H = 651;
const CAPA = "/cardapio-capa-sororoca.png";
const norm = (s: string) => (s || "").trim().toLowerCase().normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "");

type Lay = Required<Omit<CardapioLayout, "fontesCustom" | "secaoPos">> & { fontesCustom: string[]; secaoPos: { [k: string]: number } };
// Posição vertical default por seção (topo alinhado; baixo mais pra baixo).
const POS_PADRAO: { [k: string]: number } = { sobremesa: 40, frio: 40, brasa: 40, quente: 330, acompanhamento: 330 };
const PADROES: Lay = {
  fonteTitulos: "dm-serif-display", fonteCorpo: "inter", fontesCustom: [],
  espacoPratos: 11, espacoSecoes: 24, tamTitulo: 13, tamDescricao: 10, tamSecao: 17,
  tituloCapa: "COMIDAS", tamTituloCapa: 13, offsetTituloCapa: 0, secaoPos: {}, mostrarCifrao: true,
};

export function CardapioVisual({ rid, secoes, nomeRestaurante, lang, onClose }: {
  rid: string; secoes: SecaoCardapio[]; nomeRestaurante?: string; lang: "pt" | "en"; onClose: () => void;
}) {
  const ehSororoca = /soror/i.test(nomeRestaurante || "");
  const [lay, setLay] = useState<Lay>(PADROES);
  const [baixando, setBaixando] = useState(false);
  const [addFonte, setAddFonte] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [salvoFlash, setSalvoFlash] = useState(false);
  const paginasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getDoc(doc(db, "cardapioEstruturado", rid)).then((s) => {
      const l = s.exists() ? (s.data().layout as CardapioLayout | undefined) : undefined;
      if (l) setLay({ ...PADROES, ...l, fontesCustom: l.fontesCustom || [], secaoPos: l.secaoPos || {} });
    });
  }, [rid]);

  // Carrega TODAS as opções de fonte (curadas + custom) — pro preview do dropdown.
  useEffect(() => {
    const url = urlCss2(opcoesFonte(lay.fontesCustom));
    if (!url) return;
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = url;
    document.head.appendChild(link);
    return () => { link.remove(); };
  }, [lay.fontesCustom]);

  function setCampo<K extends keyof Lay>(k: K, v: Lay[K]) { setDirty(true); setLay((p) => ({ ...p, [k]: v })); }
  function adicionarFonte(family: string) {
    const f = family.trim(); if (!f) return;
    setDirty(true); setLay((p) => ({ ...p, fontesCustom: [...new Set([...p.fontesCustom, f])] }));
  }
  function setPos(chave: string, v: number) { setDirty(true); setLay((p) => ({ ...p, secaoPos: { ...p.secaoPos, [chave]: v } })); }

  async function salvarLayout() {
    setSalvando(true);
    try {
      await updateDoc(doc(db, "cardapioEstruturado", rid), sanitizeForFirestore({ layout: lay }));
      setDirty(false); setSalvoFlash(true); setTimeout(() => setSalvoFlash(false), 2200);
    } catch { /* mantém dirty */ }
    finally { setSalvando(false); }
  }
  function tentarFechar() {
    if (dirty && !window.confirm("Você tem alterações de formatação não salvas. Fechar sem salvar?")) return;
    onClose();
  }

  const fTit = resolverFonte(lay.fonteTitulos, lay.fontesCustom).cssFamily;
  const fCorpo = resolverFonte(lay.fonteCorpo, lay.fontesCustom).cssFamily;
  const en = lang === "en";
  const achar = (chave: string) => secoes.find((s) => norm(s.nome).includes(chave));

  const Secao = ({ s }: { s: SecaoCardapio }) => {
    const nome = (en && s.nomeEn) || s.nome;
    const obs = (en && s.obsEn) || s.obs;
    return (
      <div style={{ marginBottom: lay.espacoSecoes }}>
        <div style={{ textAlign: "center", marginBottom: 9 }}>
          <span style={{ fontFamily: fTit, fontSize: lay.tamSecao, color: TEAL, fontWeight: 600 }}>{nome}</span>
        </div>
        {obs && <div style={{ fontFamily: fCorpo, fontSize: lay.tamDescricao, fontStyle: "italic", color: "#888", textAlign: "center", marginBottom: 8 }}>{obs}</div>}
        {s.pratos.map((p) => {
          const titulo = (en && p.tituloEn) || p.titulo; if (!titulo) return null;
          const subt = (en && p.subtituloEn) || p.subtitulo;
          const preco = (p.preco || "").trim();
          const ehNota = /[a-zA-Z]/.test(preco);
          const precoTxt = preco ? (ehNota ? preco : (lay.mostrarCifrao ? `$ ${preco}` : preco)) : "";
          return (
            <div key={p.id} style={{ marginBottom: lay.espacoPratos }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontFamily: fCorpo, fontSize: lay.tamTitulo, fontWeight: 600, color: "#222" }}>{titulo}</span>
                {precoTxt && <span style={{ fontFamily: fCorpo, fontSize: ehNota ? lay.tamDescricao : lay.tamTitulo, fontStyle: ehNota ? "italic" : "normal", color: TEAL, whiteSpace: "nowrap", fontWeight: 600 }}>{precoTxt}</span>}
              </div>
              {subt && <div style={{ fontFamily: fCorpo, fontSize: lay.tamDescricao, color: "#777", marginTop: 1 }}>{subt}</div>}
            </div>
          );
        })}
      </div>
    );
  };

  const pageStyle: CSSProperties = { width: PAGE_W, height: PAGE_H, background: "#fff", position: "relative", boxShadow: "0 1px 8px rgba(0,0,0,.15)", overflow: "hidden", flexShrink: 0 };
  const pad = 30, gutter = 22;
  const colW = (PAGE_W - pad * 2 - gutter) / 2;
  const xEsq = pad, xDir = pad + colW + gutter;
  const sobremesas = achar("sobremesa"), frios = achar("frio"), quentes = achar("quente"), brasa = achar("brasa"), acomp = achar("acompanhamento");
  const pos = (chave: string) => lay.secaoPos[chave] ?? POS_PADRAO[chave] ?? 40;
  const Bloco = ({ s, chave, x }: { s: SecaoCardapio; chave: string; x: number }) => (
    <div style={{ position: "absolute", top: pos(chave), left: x, width: colW }}><Secao s={s} /></div>
  );

  const paginas = ehSororoca ? (
    <>
      <div className="pagina-pdf" style={{ ...pageStyle, backgroundImage: `url(${CAPA})`, backgroundSize: "100% 100%" }}>
        {lay.tituloCapa && (
          <div style={{ position: "absolute", top: 132 + lay.offsetTituloCapa, left: "54%", width: "42%", textAlign: "center", fontFamily: fTit, fontSize: lay.tamTituloCapa, letterSpacing: 2, color: TEAL, fontWeight: 600 }}>{lay.tituloCapa}</div>
        )}
        {sobremesas && <Bloco s={sobremesas} chave="sobremesa" x={xEsq} />}
      </div>
      <div className="pagina-pdf" style={pageStyle}>
        {frios && <Bloco s={frios} chave="frio" x={xEsq} />}
        {quentes && <Bloco s={quentes} chave="quente" x={xEsq} />}
        {brasa && <Bloco s={brasa} chave="brasa" x={xDir} />}
        {acomp && <Bloco s={acomp} chave="acompanhamento" x={xDir} />}
      </div>
    </>
  ) : (
    <div className="pagina-pdf" style={{ ...pageStyle, padding: pad, boxSizing: "border-box", columnCount: 2, columnGap: 22 }}>
      {secoes.map((s) => <div key={s.id} style={{ breakInside: "avoid" }}><Secao s={s} /></div>)}
    </div>
  );

  async function baixar() {
    setBaixando(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ unit: "pt", format: "a4" });
      const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
      const nodes = Array.from(paginasRef.current?.querySelectorAll<HTMLDivElement>(".pagina-pdf") || []);
      for (let i = 0; i < nodes.length; i++) {
        const canvas = await html2canvas(nodes[i]!, { scale: 3, backgroundColor: "#ffffff", useCORS: true });
        const img = canvas.toDataURL("image/jpeg", 0.94);
        if (i > 0) pdf.addPage();
        pdf.addImage(img, "JPEG", 0, 0, W, H);
      }
      pdf.save(`${(nomeRestaurante || "cardapio").toLowerCase().replace(/\s+/g, "-")}-cardapio${en ? "-en" : ""}.pdf`);
    } catch { /* ignora */ }
    finally { setBaixando(false); }
  }

  const Slider = ({ label, k, min, max }: { label: string; k: keyof Lay; min: number; max: number }) => (
    <label style={{ display: "block", fontSize: 12, color: "#555" }}>
      <span style={{ fontWeight: 600 }}>{label}: {lay[k] as number}</span>
      <input type="range" min={min} max={max} value={lay[k] as number} onChange={(e) => setCampo(k, Number(e.target.value) as never)} className="w-full" />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-stretch justify-center p-3" onClick={tentarFechar}>
      <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-5xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
       <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Controles */}
        <div className="w-72 shrink-0 border-r border-gray-200 dark:border-gray-800 p-4 space-y-4 overflow-y-auto">
          <h3 className="font-bold text-gray-800 dark:text-gray-100">🎨 Visual do PDF</h3>

          <FontePicker label="Fonte dos títulos/seções" value={lay.fonteTitulos} custom={lay.fontesCustom} onChange={(id) => setCampo("fonteTitulos", id)} onAdicionar={() => setAddFonte(true)} />
          <FontePicker label="Fonte do corpo" value={lay.fonteCorpo} custom={lay.fontesCustom} onChange={(id) => setCampo("fonteCorpo", id)} onAdicionar={() => setAddFonte(true)} />

          <Slider label="Tamanho da seção" k="tamSecao" min={11} max={28} />
          <Slider label="Tamanho do nome do prato" k="tamTitulo" min={9} max={20} />
          <Slider label="Tamanho da descrição" k="tamDescricao" min={6} max={16} />
          <Slider label="Espaço entre pratos" k="espacoPratos" min={2} max={28} />
          <Slider label="Espaço entre seções" k="espacoSecoes" min={6} max={50} />

          <label className="flex items-center gap-2 text-[13px] text-gray-600 dark:text-gray-300 cursor-pointer">
            <input type="checkbox" checked={lay.mostrarCifrao} onChange={(e) => setCampo("mostrarCifrao", e.target.checked)} className="w-4 h-4 accent-indigo-600" />
            Mostrar cifrão <span className="font-semibold">$</span> antes do preço
          </label>

          {ehSororoca && (
            <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-3">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400">Título da capa
                <input value={lay.tituloCapa} onChange={(e) => setCampo("tituloCapa", e.target.value)} placeholder="ex: COMIDAS" className="mt-1 w-full px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
              </label>
              <Slider label="Tamanho do título da capa" k="tamTituloCapa" min={8} max={28} />
              <Slider label="Posição vertical (↑ ↓)" k="offsetTituloCapa" min={-80} max={120} />
            </div>
          )}

          {ehSororoca && (
            <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-2">
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-400">Posição vertical das seções</div>
              {([["sobremesa", sobremesas], ["frio", frios], ["quente", quentes], ["brasa", brasa], ["acompanhamento", acomp]] as const)
                .filter(([, s]) => s)
                .map(([chave, s]) => (
                  <label key={chave} style={{ display: "block", fontSize: 12, color: "#555" }}>
                    <span style={{ fontWeight: 600 }}>{s!.nome}: {pos(chave)}</span>
                    <input type="range" min={10} max={560} value={pos(chave)} onChange={(e) => setPos(chave, Number(e.target.value))} className="w-full" />
                  </label>
                ))}
              <p className="text-[11px] text-gray-400">Topo = seções de cima (Sobremesas/Frios/Brasa, alinhadas). Aumente pra descer Quentes/Acompanhamentos.</p>
            </div>
          )}
          <p className="text-[11px] text-gray-400">Ajuste e veja ao vivo. O PDF baixa exatamente como no preview.</p>
        </div>

        {/* Preview */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-800">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Pré-visualização{en ? " (EN)" : ""}</span>
          </div>
          <div className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-950 p-5">
            <div ref={paginasRef} className="flex flex-col items-center gap-5">{paginas}</div>
          </div>
        </div>
       </div>

       {/* Rodapé: status + salvar + baixar + fechar */}
       <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60">
         <span className="text-[13px]">
           {salvando ? <span className="text-gray-500">salvando…</span>
             : salvoFlash ? <span className="text-emerald-600 dark:text-emerald-400 font-medium">✓ Formatação salva</span>
             : dirty ? <span className="text-amber-600 dark:text-amber-400">● Alterações não salvas</span>
             : <span className="text-gray-400">Tudo salvo</span>}
         </span>
         <div className="flex items-center gap-2">
           <button type="button" disabled={baixando} onClick={() => void baixar()} className="text-[13px] px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50">{baixando ? "gerando…" : "⬇ Baixar PDF"}</button>
           <button type="button" disabled={!dirty || salvando} onClick={() => void salvarLayout()} className="text-[13px] font-semibold px-4 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50">💾 Salvar</button>
           <button type="button" onClick={tentarFechar} className="text-[13px] px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Fechar</button>
         </div>
       </div>
      </div>

      {addFonte && <AdicionarFonteModal onClose={() => setAddFonte(false)} onAdd={(f) => { adicionarFonte(f); setAddFonte(false); }} />}
    </div>
  );
}

// ─── Dropdown de fonte: cada opção renderizada na sua própria fonte ──────────
function FontePicker({ label, value, custom, onChange, onAdicionar }: {
  label: string; value: string; custom: string[]; onChange: (id: string) => void; onAdicionar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const opcoes = opcoesFonte(custom);
  const atual = resolverFonte(value, custom);
  useEffect(() => {
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);
  return (
    <div ref={ref} className="relative">
      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <button type="button" onClick={() => setAberto((v) => !v)}
        className="w-full text-left px-2.5 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 flex items-center justify-between gap-2">
        <span style={{ fontFamily: atual.cssFamily }} className="truncate">{atual.nome}</span>
        <span className="text-gray-400">▾</span>
      </button>
      {aberto && (
        <div className="absolute z-10 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
          {opcoes.map((o) => (
            <button key={o.id} type="button" onClick={() => { onChange(o.id); setAberto(false); }}
              className={`block w-full text-left px-3 py-2 text-[15px] hover:bg-indigo-50 dark:hover:bg-indigo-900/30 ${o.id === value ? "bg-indigo-50 dark:bg-indigo-900/20" : ""}`}
              style={{ fontFamily: o.cssFamily }}>
              {o.nome}
            </button>
          ))}
          <button type="button" onClick={() => { setAberto(false); onAdicionar(); }}
            className="block w-full text-left px-3 py-2 text-[13px] font-semibold text-indigo-600 border-t border-gray-100 dark:border-gray-800">
            + Adicionar fonte do Google
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Modal: adicionar qualquer fonte do Google ───────────────────────────────
function AdicionarFonteModal({ onClose, onAdd }: { onClose: () => void; onAdd: (family: string) => void }) {
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<string[]>([]);
  const previewFamily = busca.trim();

  // Lista completa do Google (sem chave) — pra busca. Se falhar, usa só o input.
  useEffect(() => {
    let cancel = false;
    void fetch("https://gwfh.mranftl.com/api/fonts").then((r) => r.ok ? r.json() : []).then((arr) => {
      if (cancel || !Array.isArray(arr)) return;
      setLista(arr.map((f: { family?: string }) => f.family || "").filter(Boolean));
    }).catch(() => {});
    return () => { cancel = true; };
  }, []);

  // Carrega a fonte digitada pra preview.
  useEffect(() => {
    if (!previewFamily) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = urlCss2([fonteCustom(previewFamily)]) || "";
    document.head.appendChild(link);
    return () => { link.remove(); };
  }, [previewFamily]);

  const filtradas = busca.trim().length >= 2
    ? lista.filter((f) => f.toLowerCase().includes(busca.trim().toLowerCase())).slice(0, 40)
    : [];

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-800 dark:text-gray-100">Adicionar fonte do Google</h3>
        <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Digite o nome (ex: Bebas Neue, Poppins…)"
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
        {previewFamily && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2">
            <div className="text-[10px] uppercase text-gray-400">Prévia</div>
            <div style={{ fontFamily: `'${previewFamily}', sans-serif`, fontSize: 22 }}>{previewFamily}</div>
          </div>
        )}
        {filtradas.length > 0 && (
          <div className="max-h-48 overflow-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {filtradas.map((f) => (
              <button key={f} type="button" onClick={() => setBusca(f)} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/20">{f}</button>
            ))}
          </div>
        )}
        <div className="flex justify-between items-center gap-2 pt-1">
          <a href="https://fonts.google.com" target="_blank" rel="noreferrer" className="text-[11px] text-gray-400 hover:underline">ver no Google Fonts ↗</a>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="text-[13px] px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Cancelar</button>
            <button type="button" disabled={!previewFamily} onClick={() => onAdd(previewFamily)} className="text-[13px] font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-50">Adicionar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
