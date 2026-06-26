// Designer interativo do PDF do cardápio: escolhe fontes (Google, com preview na
// própria fonte + adicionar qualquer família), regula tamanhos/espaçamentos e o
// título da capa, e vê o A4 ao vivo. O PDF é gerado do PRÓPRIO preview
// (html2canvas → jsPDF) — a fonte sai idêntica à da tela.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { opcoesFonte, resolverFonte, urlCss2, fonteCustom, FONTES_GOOGLE_POPULARES } from "./shared/cardapioFontes";
import type { CardapioLayout, SecaoCardapio } from "../../core/types";

const TEAL = "#1d3c4b";
const PAGE_W = 460, PAGE_H = 651;
const CAPA = "/cardapio-capa-sororoca.png";
const norm = (s: string) => (s || "").trim().toLowerCase().normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "");

type CampoPrato = "titulo" | "subtitulo" | "tituloEn" | "subtituloEn";
type Lay = Required<Omit<CardapioLayout, "fontesCustom" | "secaoPos">> & { fontesCustom: string[]; secaoPos: { [k: string]: number } };
const PADROES: Lay = {
  fonteTitulos: "dm-serif-display", fonteCorpo: "inter", fontesCustom: [],
  espacoPratos: 8, espacoDescricao: 1, espacoSecoes: 24, tamTitulo: 13, tamDescricao: 10, tamSecao: 17,
  tituloCapa: "COMIDAS", tamTituloCapa: 13, offsetTituloCapa: 0, secaoPos: {}, mostrarCifrao: true,
  margemTopo: 34, margemBaixo: 40,
};

export function CardapioVisual({ rid, secoes, nomeRestaurante, nomeMenu, tituloCapa, onTituloCapa, lang, onEditarPrato, onSecoes, onClose }: {
  rid: string; secoes: SecaoCardapio[]; nomeRestaurante?: string; nomeMenu?: string;
  tituloCapa?: string; onTituloCapa?: (v: string) => void; lang: "pt" | "en";
  onEditarPrato?: (pratoId: string, campo: CampoPrato, valor: string) => void;
  onSecoes?: (next: SecaoCardapio[]) => void;
  onClose: () => void;
}) {
  const ehSororoca = /soror/i.test(nomeRestaurante || "");
  const [tCapa, setTCapa] = useState(tituloCapa ?? "");
  useEffect(() => { setTCapa(tituloCapa ?? ""); }, [tituloCapa]);
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

  const Secao = ({ s }: { s: SecaoCardapio }) => {
    const nome = (en && s.nomeEn) || s.nome;
    const obs = (en && s.obsEn) || s.obs;
    return (
      <div>
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
          const campoTit: CampoPrato = en ? "tituloEn" : "titulo";
          const campoSub: CampoPrato = en ? "subtituloEn" : "subtitulo";
          return (
            <div key={p.id} style={{ marginBottom: lay.espacoPratos }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span contentEditable={!!onEditarPrato} suppressContentEditableWarning
                  onBlur={(e) => onEditarPrato?.(p.id, campoTit, e.currentTarget.innerText)}
                  style={{ fontFamily: fCorpo, fontSize: lay.tamTitulo, fontWeight: 600, color: "#222", whiteSpace: "pre-line", outline: "none" }}>{titulo}</span>
                {precoTxt && <span style={{ fontFamily: fCorpo, fontSize: ehNota ? lay.tamDescricao : lay.tamTitulo, fontStyle: ehNota ? "italic" : "normal", color: TEAL, whiteSpace: "nowrap", fontWeight: 600 }}>{precoTxt}</span>}
              </div>
              <div contentEditable={!!onEditarPrato} suppressContentEditableWarning
                onBlur={(e) => onEditarPrato?.(p.id, campoSub, e.currentTarget.innerText)}
                style={{ fontFamily: fCorpo, fontSize: lay.tamDescricao, color: "#777", marginTop: lay.espacoDescricao, lineHeight: 1.25, whiteSpace: "pre-line", outline: "none", minHeight: subt ? undefined : lay.tamDescricao }}>{subt || ""}</div>
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

  // ── Distribuição generalizada: cada seção tem página (1..N) e coluna (0=esq, 1=dir).
  // Dentro de uma coluna, empilha na ordem do array `secoes`. Sem valor explícito,
  // usa um padrão sensato (Comidas-Sororoca preserva o layout antigo; demais = pág de
  // conteúdo dividida meio-a-meio). Página 1 = capa quando o restaurante tem arte.
  const COMIDAS_DEF: Record<string, [number, number]> = { sobremesa: [1, 0], frio: [2, 0], quente: [2, 0], brasa: [2, 1], acompanhamento: [2, 1] };
  const defAtrib = (s: SecaoCardapio, i: number): [number, number] => {
    const k = Object.keys(COMIDAS_DEF).find((c) => norm(s.nome).includes(c));
    if (k) return COMIDAS_DEF[k]!;
    return [ehSororoca ? 2 : 1, i < Math.ceil(secoes.length / 2) ? 0 : 1];
  };
  const efPag = (s: SecaoCardapio, i: number) => s.pagina ?? defAtrib(s, i)[0];
  const efCol = (s: SecaoCardapio, i: number) => s.coluna ?? defAtrib(s, i)[1];
  const numPag = Math.max(1, ...secoes.map((s, i) => efPag(s, i)));

  // Materializa as atribuições efetivas (torna explícito) e aplica patch/troca.
  const materializar = () => secoes.map((s, i) => ({ ...s, pagina: efPag(s, i), coluna: efCol(s, i) }));
  const setAtrib = (i: number, patch: Partial<SecaoCardapio>) => { const m = materializar(); m[i] = { ...m[i]!, ...patch }; onSecoes?.(m); };
  const moverNaColuna = (i: number, dir: -1 | 1) => {
    const p = efPag(secoes[i]!, i), c = efCol(secoes[i]!, i);
    let j = i + dir;
    while (j >= 0 && j < secoes.length && !(efPag(secoes[j]!, j) === p && efCol(secoes[j]!, j) === c)) j += dir;
    if (j < 0 || j >= secoes.length) return;
    const m = materializar(); [m[i], m[j]] = [m[j]!, m[i]!]; onSecoes?.(m);
  };

  const GuiaMargens = () => (
    <>
      <div className="guia-margem" style={{ position: "absolute", left: 0, right: 0, top: lay.margemTopo, borderTop: "1px dashed #c4b59060", pointerEvents: "none" }} />
      <div className="guia-margem" style={{ position: "absolute", left: 0, right: 0, top: PAGE_H - lay.margemBaixo, borderTop: "1px dashed #c4b59060", pointerEvents: "none" }} />
    </>
  );

  const Coluna = ({ p, c, x }: { p: number; c: number; x: number }) => {
    const lista = secoes.map((s, i) => ({ s, i })).filter(({ s, i }) => efPag(s, i) === p && efCol(s, i) === c);
    if (!lista.length) return null;
    return (
      <div style={{ position: "absolute", top: lay.margemTopo, left: x, width: colW, display: "flex", flexDirection: "column", gap: lay.espacoSecoes }}>
        {lista.map(({ s }) => <div key={s.id} style={{ marginTop: s.posTop || 0 }}><Secao s={s} /></div>)}
      </div>
    );
  };

  const tituloCapaMenu = (tCapa || (nomeMenu || "").toUpperCase()) || "";
  const Pagina = ({ p }: { p: number }) => {
    const capa = ehSororoca && p === 1;
    return (
      <div className="pagina-pdf" style={{ ...pageStyle, ...(capa ? { backgroundImage: `url(${CAPA})`, backgroundSize: "100% 100%" } : {}) }}>
        <GuiaMargens />
        {capa && tituloCapaMenu && (
          <div style={{ position: "absolute", top: 132 + lay.offsetTituloCapa, left: "54%", width: "42%", textAlign: "center", fontFamily: fTit, fontSize: lay.tamTituloCapa, letterSpacing: 2, color: TEAL, fontWeight: 600 }}>{tituloCapaMenu}</div>
        )}
        <Coluna p={p} c={0} x={xEsq} />
        <Coluna p={p} c={1} x={xDir} />
      </div>
    );
  };

  const paginas = <>{Array.from({ length: numPag }, (_, k) => <Pagina key={k} p={k + 1} />)}</>;

  async function baixar() {
    setBaixando(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ unit: "pt", format: "a4" });
      const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
      const nodes = Array.from(paginasRef.current?.querySelectorAll<HTMLDivElement>(".pagina-pdf") || []);
      for (let i = 0; i < nodes.length; i++) {
        const canvas = await html2canvas(nodes[i]!, { scale: 3, backgroundColor: "#ffffff", useCORS: true, ignoreElements: (el) => el.classList?.contains("guia-margem") });
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
          <Slider label="Espaço entre pratos" k="espacoPratos" min={0} max={28} />
          <Slider label="Espaço título → descrição" k="espacoDescricao" min={-4} max={16} />
          <Slider label="Espaço entre seções" k="espacoSecoes" min={0} max={60} />

          <label className="flex items-center gap-2 text-[13px] text-gray-600 dark:text-gray-300 cursor-pointer">
            <input type="checkbox" checked={lay.mostrarCifrao} onChange={(e) => setCampo("mostrarCifrao", e.target.checked)} className="w-4 h-4 accent-indigo-600" />
            Mostrar cifrão <span className="font-semibold">$</span> antes do preço
          </label>

          {ehSororoca && (
            <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-3">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400">Título da capa
                <input value={tCapa} onChange={(e) => { setTCapa(e.target.value); onTituloCapa?.(e.target.value); }} placeholder={(nomeMenu || "").toUpperCase() || "ex: COMIDAS"} className="mt-1 w-full px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
              </label>
              <Slider label="Tamanho do título da capa" k="tamTituloCapa" min={8} max={28} />
              <Slider label="Posição vertical (↑ ↓)" k="offsetTituloCapa" min={-80} max={120} />
            </div>
          )}

          <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-2">
            <div className="text-xs font-semibold text-gray-600 dark:text-gray-400">Margens</div>
            <Slider label="Margem superior" k="margemTopo" min={10} max={120} />
            <Slider label="Margem inferior" k="margemBaixo" min={10} max={120} />
          </div>

          {onSecoes && (
            <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-1.5">
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-400">Distribuição das seções</div>
              <p className="text-[11px] text-gray-400">Página e lado de cada seção. Dentro da coluna, ↑ ↓ define a ordem de empilhamento.</p>
              {secoes.length === 0 && <p className="text-[11px] text-gray-400">Nenhuma seção ainda.</p>}
              {secoes.map((s, i) => {
                const p = efPag(s, i), c = efCol(s, i), pos = s.posTop || 0;
                return (
                  <div key={s.id} className="border border-gray-100 dark:border-gray-800 rounded-lg px-2.5 py-2 space-y-1.5">
                    <div className="text-[12px] font-semibold text-gray-700 dark:text-gray-200 truncate">{s.nome || "—"}</div>
                    <div className="flex items-center gap-1.5">
                      <select value={p} onChange={(e) => setAtrib(i, { pagina: Number(e.target.value) })}
                        className="text-[11px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 px-1 py-0.5">
                        {Array.from({ length: numPag }, (_, k) => k + 1).map((n) => <option key={n} value={n}>pg {n}</option>)}
                        <option value={numPag + 1}>+ pg {numPag + 1}</option>
                      </select>
                      <div className="flex rounded-md overflow-hidden border border-gray-200 dark:border-gray-700 shrink-0">
                        <button type="button" onClick={() => setAtrib(i, { coluna: 0 })} className={`px-2 py-0.5 text-[11px] ${c === 0 ? "bg-indigo-600 text-white" : "text-gray-500"}`}>Esq</button>
                        <button type="button" onClick={() => setAtrib(i, { coluna: 1 })} className={`px-2 py-0.5 text-[11px] ${c === 1 ? "bg-indigo-600 text-white" : "text-gray-500"}`}>Dir</button>
                      </div>
                      <span className="flex-1" />
                      <button type="button" title="Subir na coluna" onClick={() => moverNaColuna(i, -1)} className="px-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">↑</button>
                      <button type="button" title="Descer na coluna" onClick={() => moverNaColuna(i, 1)} className="px-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">↓</button>
                    </div>
                    <label className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400 shrink-0 w-12">↕ {pos}px</span>
                      <input type="range" min={0} max={320} value={pos} onChange={(e) => setAtrib(i, { posTop: Number(e.target.value) })} className="flex-1" />
                    </label>
                  </div>
                );
              })}
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
  const q = busca.trim().toLowerCase();
  const digitada = busca.trim();

  // Filtra a lista embutida (sem rede). Sempre mostra algo: sem busca = lista toda.
  const filtradas = (q.length === 0 ? FONTES_GOOGLE_POPULARES : FONTES_GOOGLE_POPULARES.filter((f) => f.toLowerCase().includes(q))).slice(0, 80);
  // Permite adicionar uma família digitada que não está na lista (qualquer fonte do Google).
  const mostrarDigitada = digitada.length >= 2 && !FONTES_GOOGLE_POPULARES.some((f) => f.toLowerCase() === digitada.toLowerCase());
  const visiveis = [...(mostrarDigitada ? [digitada] : []), ...filtradas];

  // Carrega as fontes visíveis (cada linha renderiza na própria fonte). Recarrega
  // num pequeno debounce conforme o usuário digita.
  useEffect(() => {
    if (!visiveis.length) return;
    const t = window.setTimeout(() => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = urlCss2(visiveis.slice(0, 60).map(fonteCustom)) || "";
      link.dataset.fontePreview = "1";
      document.head.appendChild(link);
    }, 250);
    return () => {
      clearTimeout(t);
      document.head.querySelectorAll('link[data-fonte-preview="1"]').forEach((l) => l.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md p-4 space-y-3 flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-800 dark:text-gray-100">Adicionar fonte do Google</h3>
        <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquise a fonte (ex: Bebas Neue, Playfair…)"
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
        <p className="text-[11px] text-gray-400">Clique numa fonte pra adicioná-la. A prévia aparece na própria fonte.</p>
        <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {mostrarDigitada && (
            <button type="button" onClick={() => onAdd(digitada)}
              className="flex items-center justify-between gap-3 w-full text-left px-3 py-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
              <span style={{ fontFamily: `'${digitada}', sans-serif`, fontSize: 20 }} className="truncate text-gray-900 dark:text-gray-100">{digitada}</span>
              <span className="text-[11px] text-indigo-600 shrink-0">usar esta ↵</span>
            </button>
          )}
          {filtradas.map((f) => (
            <button key={f} type="button" onClick={() => onAdd(f)}
              className="flex items-center justify-between gap-3 w-full text-left px-3 py-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
              <span style={{ fontFamily: `'${f}', sans-serif`, fontSize: 20 }} className="truncate text-gray-900 dark:text-gray-100">{f}</span>
              <span className="text-[11px] text-gray-400 shrink-0">{f}</span>
            </button>
          ))}
          {!visiveis.length && <div className="px-3 py-6 text-center text-[13px] text-gray-400">Nenhuma fonte encontrada. Digite o nome exato pra adicionar mesmo assim.</div>}
        </div>
        <div className="flex justify-between items-center gap-2">
          <a href="https://fonts.google.com" target="_blank" rel="noreferrer" className="text-[11px] text-gray-400 hover:underline">ver no Google Fonts ↗</a>
          <button type="button" onClick={onClose} className="text-[13px] px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Fechar</button>
        </div>
      </div>
    </div>
  );
}
