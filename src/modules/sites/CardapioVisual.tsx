// Designer interativo do PDF do cardápio: escolhe fontes (Google, com preview na
// própria fonte + adicionar qualquer família), regula tamanhos/espaçamentos e o
// título da capa, e vê o A4 ao vivo. O PDF é gerado do PRÓPRIO preview
// (html2canvas → jsPDF) — a fonte sai idêntica à da tela.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { doc, getDoc, updateDoc, setDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { resolverFonte } from "./shared/cardapioFontes";
import { carregarFontesCardapio } from "./shared/FontePicker";
import type { CardapioEstruturado, CardapioLayout, SecaoCardapio } from "../../core/types";

const TEAL = "#1d3c4b";
const PAGE_W = 460, PAGE_H = 651;
const CAPA = "/cardapio-capa-sororoca.png";
const norm = (s: string) => (s || "").trim().toLowerCase().normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "");

type CampoPrato = "titulo" | "subtitulo" | "tituloEn" | "subtituloEn";
type Lay = Required<Omit<CardapioLayout, "fontesCustom" | "secaoPos" | "colsPorPagina">> & { fontesCustom: string[]; secaoPos: { [k: string]: number }; colsPorPagina: { [p: number]: number } };
const PADROES: Lay = {
  fonteTitulos: "dm-serif-display", fonteCorpo: "inter", fontesCustom: [],
  espacoPratos: 8, espacoDescricao: 1, espacoSecoes: 24, tamTitulo: 13, tamDescricao: 10, tamSecao: 17,
  tituloCapa: "COMIDAS", tamTituloCapa: 13, offsetTituloCapa: 0, secaoPos: {}, mostrarCifrao: true,
  margemTopo: 34, margemBaixo: 40, colGap: 22,
  capaUrl: "", mioloUrl: "", capaTitLeftPct: 54, capaTitTopPct: 20, colsPadrao: 2, colsPorPagina: {},
};
const montarLay = (l?: CardapioLayout): Lay => l ? { ...PADROES, ...l, fontesCustom: l.fontesCustom || [], secaoPos: l.secaoPos || {}, colsPorPagina: l.colsPorPagina || {} } : PADROES;

export function CardapioVisual({ rid, menuId, secoes, nomeRestaurante, nomeMenu, tituloCapa, onTituloCapa, lang, onEditarPrato, onSecoes, sharedLayout, menuLayoutProprio, menuLayout, onClose }: {
  rid: string; menuId?: string; secoes: SecaoCardapio[]; nomeRestaurante?: string; nomeMenu?: string;
  tituloCapa?: string; onTituloCapa?: (v: string) => void; lang: "pt" | "en";
  onEditarPrato?: (pratoId: string, campo: CampoPrato, valor: string) => void;
  onSecoes?: (next: SecaoCardapio[]) => void;
  sharedLayout?: CardapioLayout; menuLayoutProprio?: boolean; menuLayout?: CardapioLayout;
  onClose: () => void;
}) {
  const ehSororoca = /soror/i.test(nomeRestaurante || "");
  const [tCapa, setTCapa] = useState(tituloCapa ?? "");
  useEffect(() => { setTCapa(tituloCapa ?? ""); }, [tituloCapa]);
  // Inicializa JÁ com o layout vindo por props (carregado pelo CardapioPage) — abre
  // instantâneo, sem esperar o getDoc. O getDoc abaixo só confirma/atualiza depois.
  const [lay, setLay] = useState<Lay>(() => montarLay(menuLayoutProprio && menuLayout ? menuLayout : sharedLayout));
  const [baixando, setBaixando] = useState(false);
  const [erroBaixar, setErroBaixar] = useState("");
  const [subindoArte, setSubindoArte] = useState<"capa" | "miolo" | "">("");

  async function subirArte(tipo: "capa" | "miolo", file: File) {
    setSubindoArte(tipo);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      const path = `cardapios/${rid}/arte-${tipo}-${Date.now()}.${ext}`;
      const snap = await uploadBytes(storageRef(storage, path), file, { contentType: file.type || "image/png" });
      const url = await getDownloadURL(snap.ref);
      setCampo(tipo === "capa" ? "capaUrl" : "mioloUrl", url as never);
    } catch (e) { alert("Erro ao subir a arte: " + (e instanceof Error ? e.message : "?")); }
    finally { setSubindoArte(""); }
  }
  const [dirty, setDirty] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [salvoFlash, setSalvoFlash] = useState(false);
  const [alturas, setAlturas] = useState<Record<string, number>>({});
  const [layoutProprio, setLayoutProprio] = useState(!!menuLayoutProprio);
  const [aba, setAba] = useState<"ajustes" | "previa">("ajustes"); // só no mobile
  const [escala, setEscala] = useState(1); // encaixa o A4 na largura do preview
  const scrollRef = useRef<HTMLDivElement>(null);
  // Fontes vêm SEMPRE do restaurante (aba Configurações). O designer não troca fonte.
  const [fontes, setFontes] = useState<{ titulos?: string; corpo?: string; custom: string[] }>(
    () => ({ titulos: sharedLayout?.fonteTitulos, corpo: sharedLayout?.fonteCorpo, custom: sharedLayout?.fontesCustom || [] }));
  const paginasRef = useRef<HTMLDivElement>(null);

  // Mede a altura natural de cada seção (pra calcular a posição-padrão empilhada).
  const medir = (id: string) => (el: HTMLDivElement | null) => {
    if (!el) return;
    const h = el.offsetHeight;
    setAlturas((prev) => prev[id] === h ? prev : { ...prev, [id]: h });
  };

  // Carrega o layout efetivo: por padrão o COMPARTILHADO do restaurante; se este
  // cardápio tem `layoutProprio`, carrega o layout dele.
  useEffect(() => {
    void getDoc(doc(db, "cardapioEstruturado", rid)).then((s) => {
      const d = s.exists() ? (s.data() as CardapioEstruturado) : null;
      const menu = menuId ? (d?.cardapios || []).find((c) => c.id === menuId) : null;
      const proprio = !!menu?.layoutProprio;
      setLayoutProprio(proprio);
      setLay(montarLay((proprio ? menu?.layout : d?.layout) as CardapioLayout | undefined));
      // Fontes: sempre as do restaurante (layout compartilhado), independente de override.
      const compart = d?.layout as CardapioLayout | undefined;
      setFontes({ titulos: compart?.fonteTitulos, corpo: compart?.fonteCorpo, custom: compart?.fontesCustom || [] });
    });
  }, [rid, menuId]);

  // Carrega SÓ as 2 fontes do restaurante (título + corpo) — rápido (2 requests),
  // sem o catálogo inteiro. É o que o preview/PDF precisa.
  useEffect(() => {
    return carregarFontesCardapio(fontes.titulos, fontes.corpo, fontes.custom);
  }, [fontes]);

  // Escala o A4 (460px) pra caber na largura disponível do preview (mobile).
  useEffect(() => {
    const calc = () => {
      const el = scrollRef.current; if (!el) return;
      const avail = el.clientWidth - 24; // desconta o padding
      if (avail > 60) setEscala(Math.min(1, avail / PAGE_W));
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, [aba]);

  function setCampo<K extends keyof Lay>(k: K, v: Lay[K]) { setDirty(true); setLay((p) => ({ ...p, [k]: v })); }
  async function salvarLayout() {
    setSalvando(true);
    try {
      const ref = doc(db, "cardapioEstruturado", rid);
      if (layoutProprio && menuId) {
        // Layout SÓ deste cardápio.
        const snap = await getDoc(ref);
        const d = snap.exists() ? (snap.data() as CardapioEstruturado) : null;
        const cardapios = (d?.cardapios || []).map((c) => c.id === menuId ? { ...c, layoutProprio: true, layout: lay } : c);
        await setDoc(ref, sanitizeForFirestore({ cardapios }), { merge: true });
      } else {
        // Layout COMPARTILHADO entre todos os cardápios do restaurante.
        await updateDoc(ref, sanitizeForFirestore({ layout: lay }));
      }
      setDirty(false); setSalvoFlash(true); setTimeout(() => setSalvoFlash(false), 2200);
    } catch { /* mantém dirty */ }
    finally { setSalvando(false); }
  }

  // Liga/desliga o "formatar este cardápio diferente dos demais".
  async function toggleProprio(v: boolean) {
    setLayoutProprio(v);
    if (!menuId) return;
    const ref = doc(db, "cardapioEstruturado", rid);
    const snap = await getDoc(ref);
    const d = snap.exists() ? (snap.data() as CardapioEstruturado) : null;
    if (v) {
      // Vira próprio: parte de uma cópia do que está na tela (idêntico ao compartilhado).
      const cardapios = (d?.cardapios || []).map((c) => c.id === menuId ? { ...c, layoutProprio: true, layout: lay } : c);
      await setDoc(ref, sanitizeForFirestore({ cardapios }), { merge: true }).catch(() => {});
    } else {
      // Volta a usar o compartilhado: limpa o próprio e recarrega o compartilhado na tela.
      const cardapios = (d?.cardapios || []).map((c) => c.id === menuId ? { ...c, layoutProprio: false } : c);
      await setDoc(ref, sanitizeForFirestore({ cardapios }), { merge: true }).catch(() => {});
      const compart = d?.layout as CardapioLayout | undefined;
      setLay(compart ? { ...PADROES, ...compart, fontesCustom: compart.fontesCustom || [], secaoPos: compart.secaoPos || {} } : PADROES);
      setDirty(false);
    }
  }
  function tentarFechar() {
    if (dirty && !window.confirm("Você tem alterações de formatação não salvas. Fechar sem salvar?")) return;
    onClose();
  }

  const fTit = resolverFonte(fontes.titulos, fontes.custom).cssFamily;
  const fCorpo = resolverFonte(fontes.corpo, fontes.custom).cssFamily;
  const en = lang === "en";

  // `fatia` renderiza só um intervalo dos pratos; `semCabecalho` oculta o título/obs
  // (usado na continuação de uma seção quebrada pra outra coluna).
  const Secao = ({ s, fatia, semCabecalho }: { s: SecaoCardapio; fatia?: [number, number]; semCabecalho?: boolean }) => {
    const nome = (en && s.nomeEn) || s.nome;
    const obs = (en && s.obsEn) || s.obs;
    const pratos = fatia ? s.pratos.slice(fatia[0], fatia[1]) : s.pratos;
    return (
      <div>
        {!semCabecalho && (
          <div style={{ textAlign: "center", marginBottom: 9 }}>
            <span style={{ fontFamily: fTit, fontSize: lay.tamSecao, color: TEAL, fontWeight: 600 }}>{nome}</span>
          </div>
        )}
        {!semCabecalho && obs && <div style={{ fontFamily: fCorpo, fontSize: lay.tamDescricao, fontStyle: "italic", color: "#888", textAlign: "center", marginBottom: 8 }}>{obs}</div>}
        {pratos.map((p) => {
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
              {/* Só renderiza a descrição quando existe — assim o "espaço nome→descrição"
                  não mexe nos pratos sem descrição (pra adicionar uma, use o campo do editor). */}
              {subt && (
                <div contentEditable={!!onEditarPrato} suppressContentEditableWarning
                  onBlur={(e) => onEditarPrato?.(p.id, campoSub, e.currentTarget.innerText)}
                  style={{ fontFamily: fCorpo, fontSize: lay.tamDescricao, color: "#777", marginTop: lay.espacoDescricao, lineHeight: 1.25, whiteSpace: "pre-line", outline: "none" }}>{subt}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const pageStyle: CSSProperties = { width: PAGE_W, height: PAGE_H, background: "#fff", position: "relative", boxShadow: "0 1px 8px rgba(0,0,0,.15)", overflow: "hidden", flexShrink: 0 };
  const pad = 30, gutter = lay.colGap;
  const maxPos = Math.max(0, PAGE_H - lay.margemTopo - lay.margemBaixo);
  // Arte: capa (pág 1) e miolo (demais). Mantém a do Sororoca como fallback.
  const capaSrc = lay.capaUrl || (ehSororoca ? CAPA : "");
  const mioloSrc = lay.mioloUrl || "";

  // Nº de colunas de uma página (1..3): override por página > padrão > 2.
  const colsDe = (p: number) => Math.min(3, Math.max(1, lay.colsPorPagina[p] ?? lay.colsPadrao ?? 2));
  // Geometria de uma coluna c (0-based) numa página de n colunas.
  const colGeo = (p: number, c: number) => {
    const n = colsDe(p);
    const w = (PAGE_W - pad * 2 - gutter * (n - 1)) / n;
    return { w, x: pad + Math.min(c, n - 1) * (w + gutter) };
  };

  // ── Distribuição generalizada: cada seção tem página (1..N) e coluna (0-based).
  // Dentro de uma coluna, empilha na ordem do array `secoes`. Sem valor explícito,
  // usa um padrão sensato (Comidas-Sororoca preserva o layout antigo; demais = pág de
  // conteúdo dividida meio-a-meio). Página 1 = capa quando o restaurante tem arte.
  const COMIDAS_DEF: Record<string, [number, number]> = { sobremesa: [1, 0], frio: [2, 0], quente: [2, 0], brasa: [2, 1], acompanhamento: [2, 1] };
  const defAtrib = (s: SecaoCardapio, i: number): [number, number] => {
    const k = Object.keys(COMIDAS_DEF).find((c) => norm(s.nome).includes(c));
    if (k) return COMIDAS_DEF[k]!;
    return [capaSrc ? 2 : 1, i < Math.ceil(secoes.length / 2) ? 0 : 1];
  };
  const efPag = (s: SecaoCardapio, i: number) => s.pagina ?? defAtrib(s, i)[0];
  // Coluna efetiva travada ao nº de colunas da página da seção.
  const efCol = (s: SecaoCardapio, i: number) => Math.min((s.coluna ?? defAtrib(s, i)[1]), colsDe(efPag(s, i)) - 1);
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

  // Coluna efetiva da PARTE 2 (quebra): default = coluna seguinte, travada ao nº de colunas.
  const efColB = (s: SecaoCardapio, i: number) => Math.min(s.colB ?? Math.min(efCol(s, i) + 1, colsDe(efPag(s, i)) - 1), colsDe(efPag(s, i)) - 1);
  const temQuebra = (s: SecaoCardapio) => typeof s.quebraIdx === "number" && s.quebraIdx > 0 && s.quebraIdx < s.pratos.length;

  // Posição ABSOLUTA por bloco. Cada seção vira 1 bloco; se tiver quebra, vira 2
  // (parte A na coluna assignada + parte B, sem cabeçalho, na coluna/posição da quebra).
  // O empilhamento padrão (altura das anteriores na mesma coluna) só dá o ponto de partida.
  type Bloco = { id: string; s: SecaoCardapio; i: number; ehB: boolean; p: number; c: number; fatia: [number, number]; semCabecalho: boolean; eff: number; top: number };
  const blocos: Bloco[] = [];
  const effA: Record<string, number> = {}, effB: Record<string, number> = {};
  {
    const flow: Record<string, number> = {};
    const empilha = (p: number, c: number, h: number) => { const k = `${p}:${c}`; const def = flow[k] || 0; flow[k] = def + h + lay.espacoSecoes; return def; };
    secoes.forEach((s, i) => {
      const p = efPag(s, i), c = efCol(s, i), q = temQuebra(s);
      const fimA = q ? s.quebraIdx! : s.pratos.length;
      const defA = empilha(p, c, alturas[s.id] || 180);
      const eA = s.posTop ?? defA; effA[s.id] = eA;
      blocos.push({ id: s.id, s, i, ehB: false, p, c, fatia: [0, fimA], semCabecalho: false, eff: eA, top: lay.margemTopo + eA });
      if (q) {
        const cB = efColB(s, i);
        empilha(p, cB, alturas[`${s.id}#b`] || 180); // registra altura no fluxo da coluna
        const eB = s.posTopB ?? 0; effB[s.id] = eB; // continuação começa no TOPO da coluna por padrão
        blocos.push({ id: `${s.id}#b`, s, i, ehB: true, p, c: cB, fatia: [s.quebraIdx!, s.pratos.length], semCabecalho: true, eff: eB, top: lay.margemTopo + eB });
      }
    });
  }

  // Distribui os blocos de cada coluna igualmente entre a margem de cima e a de
  // baixo (space-between). Cada bloco (parte A ou parte B da quebra) é uma unidade
  // que termina na sua última linha.
  function distribuirNasMargens() {
    const m = materializar();
    const avail = Math.max(0, PAGE_H - lay.margemBaixo - lay.margemTopo);
    const grupos: Record<string, Bloco[]> = {};
    blocos.forEach((b) => { (grupos[`${b.p}:${b.c}`] = grupos[`${b.p}:${b.c}`] || []).push(b); });
    Object.values(grupos).forEach((arr) => {
      const ord = [...arr].sort((a, b) => a.eff - b.eff);
      const hs = ord.map((b) => alturas[b.id] || 180);
      const total = hs.reduce((a, h) => a + h, 0);
      const n = ord.length;
      let gap = n > 1 ? (avail - total) / (n - 1) : 0;
      if (gap < 6) gap = 6; // não deixa sobrepor; se estourar, segue pra baixo
      let cum = 0;
      ord.forEach((b, k) => {
        const eff = Math.round(cum);
        cum += hs[k]! + gap;
        m[b.i] = b.ehB ? { ...m[b.i]!, posTopB: eff } : { ...m[b.i]!, posTop: eff };
      });
    });
    onSecoes?.(m);
  }

  const tituloCapaMenu = (tCapa || (nomeMenu || "").toUpperCase()) || "";
  const Pagina = ({ p }: { p: number }) => {
    const capa = !!capaSrc && p === 1;
    const bg = capa ? capaSrc : mioloSrc;
    return (
      <div className="pagina-pdf" style={{ ...pageStyle, ...(bg ? { backgroundImage: `url(${bg})`, backgroundSize: "100% 100%" } : {}) }}>
        <GuiaMargens />
        {capa && tituloCapaMenu && (
          <div style={{ position: "absolute", top: `${lay.capaTitTopPct}%`, left: `${lay.capaTitLeftPct}%`, transform: "translateX(-50%)", width: "60%", textAlign: "center", fontFamily: fTit, fontSize: lay.tamTituloCapa, letterSpacing: 2, color: TEAL, fontWeight: 600 }}>{tituloCapaMenu}</div>
        )}
        {blocos.filter((b) => b.p === p).map((b) => {
          const g = colGeo(p, b.c);
          return (
            <div key={b.id} style={{ position: "absolute", top: b.top, left: g.x, width: g.w }}>
              <div ref={medir(b.id)}><Secao s={b.s} fatia={b.fatia} semCabecalho={b.semCabecalho} /></div>
            </div>
          );
        })}
      </div>
    );
  };

  const paginas = <>{Array.from({ length: numPag }, (_, k) => <Pagina key={k} p={k + 1} />)}</>;

  // Uma linha do painel de distribuição (controles de uma seção).
  const linhaDist = (s: SecaoCardapio, i: number) => {
    const p = efPag(s, i), c = efCol(s, i), pos = Math.round(effA[s.id] ?? 0);
    const q = temQuebra(s), cB = efColB(s, i), posB = Math.round(effB[s.id] ?? 0);
    const colBtn = (cn: number, sel: boolean, on: () => void) => (
      <button key={cn} type="button" onClick={on} className={`px-2 py-0.5 text-[11px] ${sel ? "bg-indigo-600 text-white" : "text-gray-500"}`} title={`Coluna ${cn + 1}`}>
        {colsDe(p) === 2 ? (cn === 0 ? "Esq" : "Dir") : cn + 1}
      </button>
    );
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
            {Array.from({ length: colsDe(p) }, (_, k) => k).map((cn) => colBtn(cn, c === cn, () => setAtrib(i, { coluna: cn })))}
          </div>
          <span className="flex-1" />
          <button type="button" title="Subir na coluna" onClick={() => moverNaColuna(i, -1)} className="px-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">↑</button>
          <button type="button" title="Descer na coluna" onClick={() => moverNaColuna(i, 1)} className="px-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">↓</button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 shrink-0">↕</span>
          <input type="range" min={0} max={maxPos} value={Math.min(pos, maxPos)} onChange={(e) => setAtrib(i, { posTop: Number(e.target.value) })} className="flex-1 h-1.5 accent-indigo-600 cursor-pointer" />
          <input type="number" min={0} max={maxPos} value={pos}
            onChange={(e) => { const n = Number(e.target.value); if (!Number.isNaN(n)) setAtrib(i, { posTop: Math.max(0, Math.min(maxPos, n)) }); }}
            className="w-14 text-right px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 text-[11px]" />
        </div>
        {/* Quebra de coluna: continua a partir de um item em outra coluna */}
        {s.pratos.length > 1 && (
          <div className="pt-1 border-t border-dashed border-gray-200 dark:border-gray-800 space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300">
              <span className="shrink-0">↪ continuar a partir de:</span>
              <select value={q ? s.quebraIdx : 0}
                onChange={(e) => { const v = Number(e.target.value); setAtrib(i, v > 0 ? { quebraIdx: v } : { quebraIdx: undefined, colB: undefined, posTopB: undefined }); }}
                className="flex-1 min-w-0 text-[11px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 px-1 py-0.5">
                <option value={0}>(não quebrar)</option>
                {s.pratos.map((pr, k) => k > 0 ? <option key={pr.id} value={k}>{(pr.titulo || `item ${k + 1}`).slice(0, 28)}</option> : null)}
              </select>
            </label>
            {q && (
              <div className="flex items-center gap-2 pl-3">
                <span className="text-[10px] text-gray-400">parte 2:</span>
                <div className="flex rounded-md overflow-hidden border border-gray-200 dark:border-gray-700 shrink-0">
                  {Array.from({ length: colsDe(p) }, (_, k) => k).map((cn) => colBtn(cn, cB === cn, () => setAtrib(i, { colB: cn })))}
                </div>
                <input type="range" min={0} max={maxPos} value={Math.min(posB, maxPos)} onChange={(e) => setAtrib(i, { posTopB: Number(e.target.value) })} className="flex-1 h-1.5 accent-indigo-600 cursor-pointer" />
                <input type="number" min={0} max={maxPos} value={posB}
                  onChange={(e) => { const n = Number(e.target.value); if (!Number.isNaN(n)) setAtrib(i, { posTopB: Math.max(0, Math.min(maxPos, n)) }); }}
                  className="w-12 text-right px-1 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 text-[11px]" />
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  async function baixar() {
    setBaixando(true); setErroBaixar("");
    try {
      // No mobile o preview pode estar escondido (aba Ajustes) → html2canvas
      // capturaria em branco. Garante a aba Prévia e espera pintar.
      setAba("previa");
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      // Garante que as fontes do Google terminaram de baixar antes do print —
      // senão o html2canvas captura no fallback e o PDF sai com fonte errada.
      try { await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* ok */ }
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ unit: "pt", format: "a4" });
      const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
      const nodes = Array.from(paginasRef.current?.querySelectorAll<HTMLDivElement>(".pagina-pdf") || []);
      if (nodes.length === 0) { setErroBaixar("Nenhuma página encontrada pra gerar o PDF. Abra a aba Prévia e tente de novo."); return; }
      // Página renderiza em ~460px; pra sair nítido no A4 precisamos de ~300 DPI.
      // scale alto + PNG (sem perda) — JPEG borrava as bordas do logo/arte.
      const scale = Math.min(6, Math.max(4, Math.ceil(2480 / (nodes[0]!.offsetWidth || 460))));
      // O preview fica reduzido por transform: scale() pra caber na tela; se o
      // html2canvas capturar assim, sai em baixa. Neutraliza o transform durante o print.
      const wrap = paginasRef.current;
      const prevT = wrap ? wrap.style.transform : "";
      if (wrap) wrap.style.transform = "none";
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      let dims = "";
      try {
        for (let i = 0; i < nodes.length; i++) {
          const canvas = await html2canvas(nodes[i]!, { scale, backgroundColor: "#ffffff", useCORS: true, imageTimeout: 0, ignoreElements: (el) => el.classList?.contains("guia-margem") });
          if (i === 0) dims = `${canvas.width}×${canvas.height}px`;
          const img = canvas.toDataURL("image/png");
          if (i > 0) pdf.addPage();
          pdf.addImage(img, "PNG", 0, 0, W, H, undefined, "FAST");
        }
      } finally {
        if (wrap) wrap.style.transform = prevT;
      }
      pdf.save(`${(nomeRestaurante || "cardapio").toLowerCase().replace(/\s+/g, "-")}-cardapio${en ? "-en" : ""}.pdf`);
      setErroBaixar(`✓ PDF gerado a ${dims} (scale ${scale}). Se ainda estiver mole, me mande esse número.`);
    } catch (e) {
      console.error("cardapio PDF:", e);
      const msg = e instanceof Error ? e.message : String(e);
      const taint = /taint|SecurityError|cross-origin|insecure/i.test(msg);
      setErroBaixar(taint
        ? "A imagem de fundo/arte do cardápio bloqueou a geração (CORS). Me avise que eu libero o acesso no servidor de imagens."
        : `Não consegui gerar o PDF: ${msg}`);
    }
    finally { setBaixando(false); }
  }

  const Slider = ({ label, k, min, max }: { label: string; k: keyof Lay; min: number; max: number }) => {
    const v = lay[k] as number;
    const set = (n: number) => setCampo(k, Math.min(max, Math.max(min, n)) as never);
    const btn = "w-7 h-6 shrink-0 flex items-center justify-center text-gray-500 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 select-none";
    return (
      <div style={{ fontSize: 12, color: "#555" }}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="flex-1 min-w-0" style={{ fontWeight: 600 }}>{label}</span>
          <div className="flex items-stretch rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden w-28 shrink-0">
            <button type="button" disabled={v <= min} onClick={() => set(v - 1)} className={`${btn} border-r border-gray-200 dark:border-gray-700`}>−</button>
            <input type="number" min={min} max={max} value={v}
              onChange={(e) => { const n = Number(e.target.value); if (!Number.isNaN(n)) setCampo(k, Math.min(max, n) as never); }}
              onBlur={() => set(v)}
              className="flex-1 w-full min-w-0 h-6 text-center bg-white dark:bg-gray-900 dark:text-gray-100 text-[12px] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
            <button type="button" disabled={v >= max} onClick={() => set(v + 1)} className={`${btn} border-l border-gray-200 dark:border-gray-700`}>+</button>
          </div>
        </div>
        <input type="range" min={min} max={max} value={v} onChange={(e) => setCampo(k, Number(e.target.value) as never)} className="w-full h-1.5 accent-indigo-600 cursor-pointer" />
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-stretch justify-center p-3" onClick={tentarFechar}>
      <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-5xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
       {/* Alternador de abas — só no mobile */}
       <div className="sm:hidden flex border-b border-gray-200 dark:border-gray-800 shrink-0">
         <button type="button" onClick={() => setAba("ajustes")} className={`flex-1 py-2.5 text-sm font-semibold ${aba === "ajustes" ? "text-indigo-700 dark:text-indigo-300 border-b-2 border-indigo-600" : "text-gray-500"}`}>🎨 Ajustes</button>
         <button type="button" onClick={() => setAba("previa")} className={`flex-1 py-2.5 text-sm font-semibold ${aba === "previa" ? "text-indigo-700 dark:text-indigo-300 border-b-2 border-indigo-600" : "text-gray-500"}`}>👁 Prévia</button>
       </div>
       <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Controles */}
        <div className={`w-full sm:w-72 sm:shrink-0 border-r border-gray-200 dark:border-gray-800 p-4 space-y-4 overflow-y-auto ${aba === "ajustes" ? "" : "hidden"} sm:block`}>
          <h3 className="font-bold text-gray-800 dark:text-gray-100">🎨 Visual do PDF</h3>

          {menuId && (
            <div className={`rounded-lg border p-2.5 ${layoutProprio ? "border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/50" : "border-gray-200 dark:border-gray-800"}`}>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={layoutProprio} onChange={(e) => void toggleProprio(e.target.checked)} className="w-4 h-4 mt-0.5 accent-amber-600" />
                <span className="text-[12px] text-gray-700 dark:text-gray-200">
                  <span className="font-semibold">Formatar este cardápio diferente dos demais</span>
                  <span className="block text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    {layoutProprio
                      ? "Fonte/tamanhos/espaçamentos valem só para este cardápio."
                      : "A formatação é única: editar aqui aplica em todos os cardápios."}
                  </span>
                </span>
              </label>
            </div>
          )}

          <div className="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/40 rounded-lg px-2.5 py-2">
            Fontes definidas em <span className="font-semibold">⚙️ Configurações</span> (valem pra todos os cardápios).
          </div>

          <PainelGrupo titulo="Tamanhos & espaçamentos" icone="📏">
            <Slider label="Tamanho da seção" k="tamSecao" min={11} max={28} />
            <Slider label="Tamanho do nome do prato" k="tamTitulo" min={9} max={20} />
            <Slider label="Tamanho da descrição" k="tamDescricao" min={6} max={16} />
            <Slider label="Espaço entre pratos" k="espacoPratos" min={0} max={28} />
            <Slider label="Espaço entre o nome do prato e descrição" k="espacoDescricao" min={-4} max={16} />
            <label className="flex items-center gap-2 text-[13px] text-gray-600 dark:text-gray-300 cursor-pointer pt-1">
              <input type="checkbox" checked={lay.mostrarCifrao} onChange={(e) => setCampo("mostrarCifrao", e.target.checked)} className="w-4 h-4 accent-indigo-600" />
              Mostrar cifrão <span className="font-semibold">$</span> antes do preço
            </label>
          </PainelGrupo>

          <PainelGrupo titulo="Arte de fundo (capa / miolo)" icone="🎨">
            <p className="text-[11px] text-gray-500 dark:text-gray-400">Pro logo e a arte saírem nítidos no PDF, suba imagens grandes (largura ≥ 2500px). A <b>capa</b> é o fundo da página 1; o <b>miolo</b> é o fundo das demais.</p>
            {([["capa", "Capa (página 1)", lay.capaUrl], ["miolo", "Miolo (demais)", lay.mioloUrl]] as const).map(([tipo, label, atual]) => (
              <div key={tipo} className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-gray-600 dark:text-gray-300">{label}{atual ? <span className="text-emerald-600"> ✓</span> : ""}</span>
                <div className="flex items-center gap-1.5">
                  {atual && <button type="button" onClick={() => setCampo(tipo === "capa" ? "capaUrl" : "mioloUrl", "" as never)} className="text-[11px] text-gray-400 hover:text-rose-600">remover</button>}
                  <label className={`text-[11px] px-2 py-1 rounded-lg border cursor-pointer ${subindoArte ? "opacity-50 border-gray-300" : "border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"}`}>
                    {subindoArte === tipo ? "enviando…" : atual ? "trocar" : "subir"}
                    <input type="file" accept="image/*" className="hidden" disabled={!!subindoArte} onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirArte(tipo, f); e.currentTarget.value = ""; }} />
                  </label>
                </div>
              </div>
            ))}
          </PainelGrupo>

          {!!capaSrc && (
            <PainelGrupo titulo="Título da capa" icone="🖼️">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400">Texto
                <input value={tCapa} onChange={(e) => { setTCapa(e.target.value); onTituloCapa?.(e.target.value); }} placeholder={(nomeMenu || "").toUpperCase() || "ex: COMIDAS"} className="mt-1 w-full px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
              </label>
              <Slider label="Tamanho" k="tamTituloCapa" min={8} max={36} />
              <Slider label="Posição horizontal (%)" k="capaTitLeftPct" min={0} max={100} />
              <Slider label="Posição vertical (%)" k="capaTitTopPct" min={0} max={100} />
            </PainelGrupo>
          )}

          <PainelGrupo titulo="Margens & colunas" icone="📐">
            <Slider label="Margem superior" k="margemTopo" min={10} max={120} />
            <Slider label="Margem inferior" k="margemBaixo" min={10} max={120} />
            <Slider label="Espaço entre colunas" k="colGap" min={8} max={90} />
            <div className="pt-1 space-y-1.5">
              <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Colunas por página</div>
              {Array.from({ length: numPag }, (_, k) => k + 1).map((p) => (
                <div key={p} className="flex items-center justify-between gap-2">
                  <span className="text-[12px] text-gray-600 dark:text-gray-300">Página {p}{capaSrc && p === 1 ? " (capa)" : ""}</span>
                  <div className="flex rounded-md overflow-hidden border border-gray-200 dark:border-gray-700 shrink-0">
                    {[1, 2, 3].map((n) => (
                      <button key={n} type="button" onClick={() => setCampo("colsPorPagina", { ...lay.colsPorPagina, [p]: n })}
                        className={`px-2.5 py-0.5 text-[11px] ${colsDe(p) === n ? "bg-indigo-600 text-white" : "text-gray-500"}`}>{n}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </PainelGrupo>

          {onSecoes && (
            <PainelGrupo titulo="Distribuição das seções" icone="🧩">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-gray-400">Listadas na ordem do layout (página · coluna · de cima pra baixo).</p>
                <button type="button" onClick={() => distribuirNasMargens()} className="shrink-0 text-[11px] font-semibold px-2 py-1 rounded-md border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300">↕ Distribuir</button>
              </div>
              {secoes.length === 0 && <p className="text-[11px] text-gray-400">Nenhuma seção ainda.</p>}
              {(() => {
                const colLabel = (p: number, c: number) => colsDe(p) === 2 ? (c === 0 ? "esquerda" : "direita") : `coluna ${c + 1}`;
                const ordem = secoes.map((s, i) => ({ s, i, p: efPag(s, i), c: efCol(s, i), top: effA[s.id] ?? 0 }))
                  .sort((a, b) => a.p - b.p || a.c - b.c || a.top - b.top);
                const out: ReactNode[] = [];
                let prev = "";
                for (const { s, i, p, c } of ordem) {
                  const g = `${p}:${c}`;
                  if (g !== prev) { out.push(<div key={`h${g}`} className="text-[10px] font-bold uppercase tracking-wide text-gray-400 pt-1.5">Página {p} · {colLabel(p, c)}</div>); prev = g; }
                  out.push(linhaDist(s, i));
                }
                return out;
              })()}
            </PainelGrupo>
          )}
          <p className="text-[11px] text-gray-400">Ajuste e veja ao vivo. O PDF baixa exatamente como no preview.</p>
        </div>

        {/* Preview */}
        <div className={`flex-1 flex-col min-w-0 ${aba === "previa" ? "flex" : "hidden"} sm:flex`}>
          <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 hidden sm:block">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Pré-visualização{en ? " (EN)" : ""}</span>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-950 p-3 sm:p-5">
            {/* Caixa dimensionada pela escala (some o scroll horizontal no mobile).
                A escala é só visual — o html2canvas captura cada página no tamanho real. */}
            <div style={{ position: "relative", width: PAGE_W * escala, height: (numPag * PAGE_H + (numPag - 1) * 20) * escala, margin: "0 auto" }}>
              <div ref={paginasRef} style={{ position: "absolute", top: 0, left: 0, width: PAGE_W, transform: `scale(${escala})`, transformOrigin: "top left" }} className="flex flex-col items-center gap-5">{paginas}</div>
            </div>
          </div>
        </div>
       </div>

       {/* Rodapé: status + salvar + baixar + fechar */}
       <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60">
         <span className="text-[13px] min-w-0">
           {erroBaixar ? <span className={erroBaixar.startsWith("✓") ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>{erroBaixar}</span>
             : salvando ? <span className="text-gray-500">salvando…</span>
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
    </div>
  );
}

// ─── Grupo colapsável do painel de controles ─────────────────────────────────
function PainelGrupo({ titulo, icone, defaultOpen = false, children }: { titulo: string; icone?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
        <span className="text-[12px] font-bold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
          {icone && <span>{icone}</span>}{titulo}
        </span>
        <span className={`text-gray-400 text-[10px] transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
      </button>
      {open && <div className="p-3 space-y-3">{children}</div>}
    </div>
  );
}
