// Edição visual do site: o preview É a tela de edição. Clica num texto/imagem
// do preview → abre o modal certo (texto campo-a-campo, imagem ou cores) →
// salva no sitesConfig. Preview num iframe (/site-preview/:rid?edit=1) pra
// isolar o estilo; o clique chega por postMessage.
import { useEffect, useRef, useState } from "react";
import { Monitor, Smartphone, X, Sparkles, Check, MousePointerClick, Palette, Image as ImageIcon, Crop } from "lucide-react";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAuth } from "../../core/auth/AuthContext";
import { auth, storage } from "../../core/firebase/config";
import { useSiteConfig } from "./useSiteConfig";
import { UploadImagem } from "./UploadImagem";
import { FONTES_SITE, CATEGORIA_LABEL } from "./templates/fontesDisponiveis";
import type { SiteConfig } from "../../core/types";

type SelTexto = { tipo: "texto"; campo: string };
type SelAsset = { tipo: "asset"; asset: "logo" | "hero" | "favicon" };
type SelTema = { tipo: "tema" };
type Sel = SelTexto | SelAsset | SelTema;

// campo → rótulo + se é texto longo + se mora no topo do config (slogan/historia)
const CAMPO: Record<string, { label: string; multi?: boolean; top?: boolean }> = {
  slogan: { label: "Slogan (linha acima do título)", top: true },
  heroTitulo: { label: "Título principal (hero)", multi: true },
  heroSubtitulo: { label: "Subtítulo (hero)", multi: true },
  heroCtaLabel: { label: "Rótulo do botão (hero)" },
  historiaTitulo: { label: "Título — Sobre" },
  historia: { label: "Texto — Sobre", multi: true, top: true },
  cardapioTitulo: { label: "Título — Cardápio" },
  horarioTitulo: { label: "Título — Horário" },
  horarioProximosAvisosLabel: { label: "Rótulo 'próximos avisos'" },
  lajeTitulo: { label: "Título — Laje" }, lajeTexto: { label: "Texto — Laje", multi: true }, lajeCtaLabel: { label: "Botão — Laje" },
  eventosTitulo: { label: "Título — Eventos" }, eventosTexto: { label: "Texto — Eventos", multi: true }, eventosCtaLabel: { label: "Botão — Eventos" },
  reservasTitulo: { label: "Título — Reservas" }, reservasTexto: { label: "Texto — Reservas", multi: true }, reservasCtaLabel: { label: "Botão — Reservas" },
  deliveryTitulo: { label: "Título — Delivery" }, deliveryTexto: { label: "Texto — Delivery", multi: true },
  trabalheTitulo: { label: "Título — Trabalhe" }, trabalheTexto: { label: "Texto — Trabalhe", multi: true }, trabalheCtaLabel: { label: "Botão — Trabalhe" },
  contatoTitulo: { label: "Título — Contato" },
  rodapeDireitos: { label: "Rodapé (após © ano)" },
};
// ── Extração de paleta de cores a partir de uma imagem (client-side) ─────────
function rgbToHex(r: number, g: number, b: number) { return "#" + [r, g, b].map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0")).join(""); }
function hexToRgb(h: string) { const m = h.replace("#", ""); return { r: parseInt(m.slice(0, 2), 16) || 0, g: parseInt(m.slice(2, 4), 16) || 0, b: parseInt(m.slice(4, 6), 16) || 0 }; }
function luminancia({ r, g, b }: { r: number; g: number; b: number }) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function clarear(hex: string, f: number) { const { r, g, b } = hexToRgb(hex); return rgbToHex(Math.round(r + (255 - r) * f), Math.round(g + (255 - g) * f), Math.round(b + (255 - b) * f)); }
function escurecer(hex: string, f: number) { const { r, g, b } = hexToRgb(hex); return rgbToHex(Math.round(r * (1 - f)), Math.round(g * (1 - f)), Math.round(b * (1 - f))); }
// Gera variações (mais claras/escuras) da paleta, sem repetir.
function variacoesDaPaleta(palette: string[]): string[] {
  const out: string[] = [];
  const seen = new Set(palette.map((h) => h.toLowerCase()));
  for (const h of palette.slice(0, 4)) {
    for (const v of [clarear(h, 0.35), escurecer(h, 0.3)]) {
      const k = v.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(v); }
    }
  }
  return out.slice(0, 8);
}
function saturacao({ r, g, b }: { r: number; g: number; b: number }) { const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255; const l = (mx + mn) / 2; const d = mx - mn; return d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)); }

async function paletaDaImagem(url: string): Promise<string[]> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("não consegui baixar a imagem");
  const blob = await resp.blob();
  const obj = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("imagem inválida")); i.src = obj; });
    const w = 84, h = Math.max(1, Math.round(84 * (img.height || 1) / (img.width || 1)));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d"); if (!ctx) return [];
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;   // ignora transparente
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const key = `${Math.round(r / 24)}-${Math.round(g / 24)}-${Math.round(b / 24)}`;
      const c = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 }; c.n++; c.r += r; c.g += g; c.b += b; buckets.set(key, c);
    }
    return [...buckets.values()].map((c) => ({ n: c.n, r: Math.round(c.r / c.n), g: Math.round(c.g / c.n), b: Math.round(c.b / c.n) }))
      .sort((a, b) => b.n - a.n).slice(0, 8).map((c) => rgbToHex(c.r, c.g, c.b));
  } finally { URL.revokeObjectURL(obj); }
}

// Deriva as 4 cores do tema a partir da paleta: fundo = mais clara, texto = mais
// escura, primária = mais vibrante, secundária = 2ª mais vibrante distinta.
function sugerirTemaDaPaleta(palette: string[]): { corPrimaria: string; corSecundaria: string; corFundo: string; corTexto: string } | null {
  if (!palette.length) return null;
  const cores = palette.map((h) => ({ h, rgb: hexToRgb(h) }));
  const porLum = [...cores].sort((a, b) => luminancia(a.rgb) - luminancia(b.rgb));
  const corFundo = porLum[porLum.length - 1].h;
  const corTexto = porLum[0].h;
  const porVib = [...cores].map((c) => ({ ...c, s: saturacao(c.rgb) })).sort((a, b) => b.s - a.s);
  const corPrimaria = porVib[0]?.h || corTexto;
  const corSecundaria = (porVib.find((c) => c.h !== corPrimaria)?.h) || corPrimaria;
  return { corPrimaria, corSecundaria, corFundo, corTexto };
}

const ASSET_INFO: Record<SelAsset["asset"], { campo: keyof SiteConfig; label: string; desc: string; tipo: "logo" | "hero" | "favicon" }> = {
  logo: { campo: "logoUrl", label: "Logo do restaurante", desc: "Aparece no topo do site. PNG com fundo transparente fica melhor.", tipo: "logo" },
  hero: { campo: "heroImagemUrl", label: "Imagem de fundo (hero)", desc: "Fundo do topo do site, com um leve escurecido por cima.", tipo: "hero" },
  favicon: { campo: "faviconUrl", label: "Favicon (ícone da aba)", desc: "Quadrado, ~64×64. Aparece na aba do navegador.", tipo: "favicon" },
};

export function EditarVisualTab({ rid, nomeRestaurante, podeEditar }: { rid: string; nomeRestaurante: string; podeEditar: boolean }) {
  const { pessoa: me } = useAuth();
  const { config, save } = useSiteConfig(rid, nomeRestaurante);
  const [sel, setSel] = useState<Sel | null>(null);
  const [vp, setVp] = useState<"desktop" | "mobile">("desktop");

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; sel?: Sel };
      if (d?.type === "site-edit" && d.sel) setSel(d.sel);
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  async function salvarCampo(campo: string, valor: string) {
    const info = CAMPO[campo];
    if (info?.top) { await save({ [campo]: valor } as Partial<SiteConfig>, me?.id || ""); }
    else { await save({ textos: { ...(config?.textos || {}), [campo]: valor } }, me?.id || ""); }
    setSel(null);
  }
  async function salvarAsset(asset: SelAsset["asset"], url: string) {
    await save({ [ASSET_INFO[asset].campo]: url } as Partial<SiteConfig>, me?.id || "");
  }
  async function salvarTema(tema: SiteConfig["tema"]) { await save({ tema }, me?.id || ""); setSel(null); }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[13px] text-gray-600 dark:text-gray-300 inline-flex items-center gap-1.5"><MousePointerClick size={15} className="text-indigo-500" /> Clique num texto ou imagem do site pra editar.</div>
        <div className="flex-1" />
        {podeEditar && <button onClick={() => setSel({ tipo: "tema" })} className="text-[12px] font-semibold px-3 h-8 rounded-lg border border-gray-200 dark:border-gray-700 inline-flex items-center gap-1.5"><Palette size={14} /> Aparência</button>}
        {podeEditar && <button onClick={() => setSel({ tipo: "asset", asset: "favicon" })} className="text-[12px] font-semibold px-3 h-8 rounded-lg border border-gray-200 dark:border-gray-700 inline-flex items-center gap-1.5"><ImageIcon size={14} /> Favicon</button>}
        <div className="flex items-center gap-1 ml-1">
          <button onClick={() => setVp("desktop")} className={`px-2.5 py-1 text-[11px] rounded ${vp === "desktop" ? "bg-indigo-600 text-white" : "bg-gray-100 dark:bg-gray-800"}`}><span className="inline-flex items-center gap-1"><Monitor size={12} /> Desktop</span></button>
          <button onClick={() => setVp("mobile")} className={`px-2.5 py-1 text-[11px] rounded ${vp === "mobile" ? "bg-indigo-600 text-white" : "bg-gray-100 dark:bg-gray-800"}`}><span className="inline-flex items-center gap-1"><Smartphone size={12} /> Mobile</span></button>
        </div>
      </div>

      <div className="rounded-2xl border-2 border-gray-300 dark:border-gray-700 overflow-hidden bg-gray-100 dark:bg-gray-900">
        <div style={{ display: "flex", justifyContent: "center", background: "#e5e7eb", padding: vp === "mobile" ? 16 : 0 }}>
          <iframe
            key={config?.updatedAt}
            src={`/site-preview/${rid}?edit=1`}
            title="Editar site"
            style={{ width: vp === "mobile" ? 390 : "100%", height: "78vh", border: "none", background: "#fff", borderRadius: vp === "mobile" ? 12 : 0, boxShadow: vp === "mobile" ? "0 4px 16px rgba(0,0,0,.15)" : "none" }}
          />
        </div>
      </div>

      {sel?.tipo === "texto" && CAMPO[sel.campo] && (
        <CampoModal campo={sel.campo} info={CAMPO[sel.campo]} valor={valorAtual(config, sel.campo)} podeEditar={podeEditar} onClose={() => setSel(null)} onSave={salvarCampo} />
      )}
      {sel?.tipo === "asset" && (
        <AssetModal rid={rid} asset={sel.asset} url={String((config as unknown as Record<string, unknown>)[ASSET_INFO[sel.asset].campo] || "")} logoUrl={config?.logoUrl || ""} podeEditar={podeEditar} onClose={() => setSel(null)} onChange={(u) => void salvarAsset(sel.asset, u)} />
      )}
      {sel?.tipo === "tema" && config && (
        <TemaModal tema={config.tema} logoUrl={config.logoUrl || ""} heroImagemUrl={config.heroImagemUrl || ""} podeEditar={podeEditar} onClose={() => setSel(null)} onSave={salvarTema} />
      )}
    </div>
  );
}

function valorAtual(config: SiteConfig | null, campo: string): string {
  if (!config) return "";
  if (CAMPO[campo]?.top) return String((config as unknown as Record<string, unknown>)[campo] ?? "");
  return String(config.textos?.[campo as keyof NonNullable<SiteConfig["textos"]>] ?? "");
}

// ── Modal de um campo de texto ───────────────────────────────────────────────
function CampoModal({ campo, info, valor, podeEditar, onClose, onSave }: {
  campo: string; info: { label: string; multi?: boolean }; valor: string; podeEditar: boolean;
  onClose: () => void; onSave: (campo: string, valor: string) => Promise<void>;
}) {
  const [v, setV] = useState(valor);
  const [salvando, setSalvando] = useState(false);
  const [ia, setIa] = useState(false);
  const [erro, setErro] = useState("");
  async function melhorar() {
    setIa(true); setErro("");
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const r = await fetch("/api/sites-ia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken, modo: "campo", campo: info.label, texto: v, instrucao: "Melhore o texto, mais claro e elegante, mantendo o sentido." }) });
      const j = await r.json();
      if (r.ok && j?.resultado?.texto) setV(String(j.resultado.texto)); else setErro(j?.error || "A IA não conseguiu.");
    } catch (e) { setErro("Falha na IA: " + (e instanceof Error ? e.message : "erro")); }
    finally { setIa(false); }
  }
  const inp = "w-full px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm";
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-[480px] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3"><div className="font-extrabold text-[15px]">{info.label}</div><div className="flex-1" /><button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"><X size={16} /></button></div>
        {info.multi
          ? <textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} disabled={!podeEditar} className={inp + " py-2"} rows={campo === "historia" ? 7 : 3} />
          : <input autoFocus value={v} onChange={(e) => setV(e.target.value)} disabled={!podeEditar} className={inp + " h-10"} />}
        {podeEditar && info.multi && <button onClick={() => void melhorar()} disabled={ia} className="text-[11px] font-bold text-indigo-600 dark:text-indigo-300 inline-flex items-center gap-1 mt-1.5 disabled:opacity-50"><Sparkles size={11} /> {ia ? "melhorando…" : "melhorar com IA"}</button>}
        {erro && <div className="text-[12px] text-rose-600 mt-1">{erro}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold">Cancelar</button>
          {podeEditar && <button onClick={async () => { setSalvando(true); try { await onSave(campo, v); } catch (e) { setErro("Falha: " + (e instanceof Error ? e.message : "erro")); setSalvando(false); } }} disabled={salvando} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1">{salvando ? "Salvando…" : <><Check size={15} /> Salvar</>}</button>}
        </div>
      </div>
    </div>
  );
}

// ── Modal de imagem (reusa UploadImagem) ─────────────────────────────────────
function AssetModal({ rid, asset, url, logoUrl, podeEditar, onClose, onChange }: {
  rid: string; asset: SelAsset["asset"]; url: string; logoUrl?: string; podeEditar: boolean;
  onClose: () => void; onChange: (url: string) => void;
}) {
  const info = ASSET_INFO[asset];
  const [recortar, setRecortar] = useState(false);
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-[480px] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3"><div className="font-extrabold text-[15px]">{info.label}</div><div className="flex-1" /><button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"><X size={16} /></button></div>
        {asset === "favicon" && podeEditar && logoUrl && (
          <button onClick={() => setRecortar(true)} className="w-full mb-3 h-10 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300 text-[13px] font-semibold inline-flex items-center justify-center gap-1.5"><Crop size={14} /> Recortar da logo (pegar só o ícone)</button>
        )}
        <UploadImagem rid={rid} tipo={info.tipo} label={info.label} descricao={info.desc} url={url} onChange={onChange} disabled={!podeEditar} />
        <div className="flex justify-end mt-4"><button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold">Fechar</button></div>
      </div>
      {recortar && logoUrl && <RecortarLogoFavicon rid={rid} logoUrl={logoUrl} onClose={() => setRecortar(false)} onDone={(u) => { onChange(u); setRecortar(false); }} />}
    </div>
  );
}

// Recorte da logo → favicon quadrado. O usuário enquadra (zoom + posição) e
// gera; sobe pro Storage (sites/{rid}/favicon.png) e devolve a URL.
function RecortarLogoFavicon({ rid, logoUrl, onClose, onDone }: { rid: string; logoUrl: string; onClose: () => void; onDone: (url: string) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1.6);
  const [px, setPx] = useState(0);
  const [py, setPy] = useState(-0.6);   // começa enquadrando o topo (onde fica o peixe)
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState("");
  const cvRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let obj = "";
    (async () => {
      try {
        const r = await fetch(logoUrl); const b = await r.blob(); obj = URL.createObjectURL(b);
        const i = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("imagem inválida")); im.src = obj; });
        setImg(i);
      } catch (e) { setErro("Não consegui carregar a logo" + (e instanceof Error ? `: ${e.message}` : "") + "."); }
    })();
    return () => { if (obj) URL.revokeObjectURL(obj); };
  }, [logoUrl]);

  function desenhar(cv: HTMLCanvasElement, i: HTMLImageElement) {
    const s = cv.width; const ctx = cv.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, s, s);
    const base = Math.max(s / i.width, s / i.height);
    const scale = base * zoom;
    const w = i.width * scale, h = i.height * scale;
    const x = (s - w) / 2 + px * Math.max(0, (w - s)) / 2;
    const y = (s - h) / 2 + py * Math.max(0, (h - s)) / 2;
    ctx.drawImage(i, x, y, w, h);
  }
  useEffect(() => { const cv = cvRef.current; if (cv && img) desenhar(cv, img); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [img, zoom, px, py]);

  async function gerar() {
    const cv = cvRef.current; if (!cv || !img) return;
    setGerando(true); setErro("");
    try {
      const out = document.createElement("canvas"); out.width = 256; out.height = 256;
      desenharEm(out, img);
      const blob = await new Promise<Blob | null>((res) => out.toBlob(res, "image/png"));
      if (!blob) throw new Error("falha ao gerar imagem");
      const ref = storageRef(storage, `sites/${rid}/favicon.png`);
      await uploadBytes(ref, blob, { contentType: "image/png" });
      const dl = await getDownloadURL(ref);
      onDone(dl);
    } catch (e) { setErro("Falha ao gerar favicon" + (e instanceof Error ? `: ${e.message}` : "") + "."); setGerando(false); }
  }
  function desenharEm(cv: HTMLCanvasElement, i: HTMLImageElement) {
    const s = cv.width; const ctx = cv.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, s, s);
    const base = Math.max(s / i.width, s / i.height);
    const scale = base * zoom;
    const w = i.width * scale, h = i.height * scale;
    const x = (s - w) / 2 + px * Math.max(0, (w - s)) / 2;
    const y = (s - h) / 2 + py * Math.max(0, (h - s)) / 2;
    ctx.drawImage(i, x, y, w, h);
  }

  const sld = "w-full accent-indigo-600";
  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-[400px] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3"><Crop size={16} className="text-indigo-500" /><div className="font-extrabold text-[15px]">Recortar favicon da logo</div><div className="flex-1" /><button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"><X size={16} /></button></div>
        <div className="grid place-items-center mb-3">
          <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700" style={{ width: 200, height: 200, background: "conic-gradient(#eee 25%, #fff 0 50%, #eee 0 75%, #fff 0) 0 0/16px 16px" }}>
            <canvas ref={cvRef} width={200} height={200} style={{ width: 200, height: 200, display: "block" }} />
          </div>
          <div className="text-[10px] text-gray-400 mt-1">Prévia — quadrado do favicon</div>
        </div>
        <div className="space-y-2">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide block">Zoom<input type="range" min={1} max={4} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className={sld} /></label>
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide block">Horizontal<input type="range" min={-1} max={1} step={0.02} value={px} onChange={(e) => setPx(Number(e.target.value))} className={sld} /></label>
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide block">Vertical<input type="range" min={-1} max={1} step={0.02} value={py} onChange={(e) => setPy(Number(e.target.value))} className={sld} /></label>
        </div>
        {erro && <div className="text-[12px] text-rose-600 mt-2">{erro}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold">Cancelar</button>
          <button onClick={() => void gerar()} disabled={gerando || !img} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1">{gerando ? "Gerando…" : <><Check size={15} /> Usar como favicon</>}</button>
        </div>
      </div>
    </div>
  );
}

// ── Modal de cores ───────────────────────────────────────────────────────────
function TemaModal({ tema, logoUrl, heroImagemUrl, podeEditar, onClose, onSave }: {
  tema: SiteConfig["tema"]; logoUrl?: string; heroImagemUrl?: string; podeEditar: boolean; onClose: () => void; onSave: (t: SiteConfig["tema"]) => Promise<void>;
}) {
  const [palette, setPalette] = useState<string[]>([]);
  const [extraindo, setExtraindo] = useState("");
  const [erroPal, setErroPal] = useState("");
  const [dropK, setDropK] = useState<string | null>(null);   // campo destacado no arraste
  const [descPrompt, setDescPrompt] = useState("");
  const [sugerindoDesc, setSugerindoDesc] = useState(false);
  const cores: { k: keyof SiteConfig["tema"]; label: string }[] = [
    { k: "corPrimaria", label: "Cor primária" },
    { k: "corSecundaria", label: "Cor secundária" },
    { k: "corFundo", label: "Cor de fundo" },
    { k: "corTexto", label: "Cor de texto" },
  ];
  const fontes: { k: keyof SiteConfig["tema"]; label: string }[] = [
    { k: "fonteHeading", label: "Fonte dos títulos" },
    { k: "fonteSubtitulo", label: "Fonte de subtítulos" },
    { k: "fonteCorpo", label: "Fonte do corpo" },
  ];
  const CATEGORIAS = ["serif_elegante", "sans_moderna", "display", "script"] as const;
  const [t, setT] = useState<SiteConfig["tema"]>(tema);
  const [salvando, setSalvando] = useState(false);
  const val = (k: keyof SiteConfig["tema"]) => (t[k] as string) || "";
  const setC = (k: keyof SiteConfig["tema"], v: string) => setT((p) => ({ ...p, [k]: v }));
  async function sugerir(url: string, origem: string) {
    setExtraindo(origem); setErroPal("");
    try {
      const pal = await paletaDaImagem(url);
      if (!pal.length) { setErroPal("Não achei cores nessa imagem."); return; }
      setPalette(pal);
      const s = sugerirTemaDaPaleta(pal);
      if (s) setT((p) => ({ ...p, ...s }));
    } catch (e) { setErroPal("Não consegui ler a imagem" + (e instanceof Error ? `: ${e.message}` : "") + "."); }
    finally { setExtraindo(""); }
  }

  async function sugerirPorDescricao() {
    const d = descPrompt.trim(); if (!d) return;
    setSugerindoDesc(true); setErroPal("");
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const r = await fetch("/api/sites-ia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken, modo: "paleta", descricao: d }) });
      const j = await r.json();
      if (!r.ok) { setErroPal(j?.error || "A IA não conseguiu sugerir."); return; }
      const res = (j.resultado || {}) as Record<string, unknown>;
      const ehHex = (x: unknown): x is string => typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x);
      const pal = Array.isArray(res.palette) ? (res.palette as unknown[]).filter(ehHex) : [];
      if (pal.length) setPalette(pal);
      const merge: Partial<SiteConfig["tema"]> = {};
      (["corPrimaria", "corSecundaria", "corFundo", "corTexto"] as const).forEach((k) => { if (ehHex(res[k])) merge[k] = (res[k] as string).toLowerCase(); });
      if (Object.keys(merge).length) setT((p) => ({ ...p, ...merge }));
    } catch (e) { setErroPal("Falha na IA" + (e instanceof Error ? `: ${e.message}` : "") + "."); }
    finally { setSugerindoDesc(false); }
  }
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-[440px] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3"><Palette size={18} className="text-indigo-500" /><div className="font-extrabold text-[15px]">Cores & fontes</div><div className="flex-1" /><button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"><X size={16} /></button></div>
        <div className="max-h-[62vh] overflow-auto pr-1 space-y-4">
          {podeEditar && (
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20 p-3">
              <div className="text-[11px] font-bold text-indigo-800 dark:text-indigo-200 uppercase tracking-wide mb-1.5 inline-flex items-center gap-1"><Sparkles size={12} /> Sugerir paleta</div>
              {/* Por descrição (IA) */}
              <div className="flex items-center gap-2">
                <input value={descPrompt} onChange={(e) => setDescPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void sugerirPorDescricao(); }} placeholder="Descreva o clima: ex. 'praiano, verde-mar e areia'" className="flex-1 min-w-0 h-9 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-[12.5px]" />
                <button type="button" onClick={() => void sugerirPorDescricao()} disabled={sugerindoDesc || !descPrompt.trim()} className="shrink-0 text-[12px] font-bold px-3 h-9 rounded-lg text-white disabled:opacity-50" style={{ background: "linear-gradient(90deg,#6d5efc,#9b6bff)" }}>{sugerindoDesc ? "…" : "Sugerir"}</button>
              </div>
              {(logoUrl || heroImagemUrl) && <div className="text-[10px] text-gray-400 mt-2 mb-1">…ou a partir da imagem:</div>}
              <div className="flex flex-wrap gap-2">
                {logoUrl && <button type="button" onClick={() => void sugerir(logoUrl, "logo")} disabled={!!extraindo} className="text-[12px] font-semibold px-3 h-8 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-900 disabled:opacity-50">{extraindo === "logo" ? "Analisando…" : "Da logo"}</button>}
                {heroImagemUrl && <button type="button" onClick={() => void sugerir(heroImagemUrl, "hero")} disabled={!!extraindo} className="text-[12px] font-semibold px-3 h-8 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-900 disabled:opacity-50">{extraindo === "hero" ? "Analisando…" : "Da imagem de fundo"}</button>}
              </div>
              {palette.length > 0 && (
                <div className="mt-2 space-y-2">
                  <div>
                    <div className="text-[10px] text-gray-500 mb-1">Paleta encontrada — <b>arraste</b> pra um campo abaixo (ou clique pra copiar):</div>
                    <div className="flex flex-wrap gap-1.5">
                      {palette.map((h) => (
                        <button key={h} type="button" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", h)} title={`${h} — arraste ou clique pra copiar`} onClick={() => navigator.clipboard?.writeText(h)} className="w-7 h-7 rounded-md border border-black/10 shrink-0 cursor-grab active:cursor-grabbing" style={{ background: h }} />
                      ))}
                    </div>
                  </div>
                  {variacoesDaPaleta(palette).length > 0 && (
                    <div>
                      <div className="text-[10px] text-gray-500 mb-1">Variações sugeridas (mais claras/escuras):</div>
                      <div className="flex flex-wrap gap-1.5">
                        {variacoesDaPaleta(palette).map((h) => (
                          <button key={h} type="button" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", h)} title={`${h} — arraste ou clique pra copiar`} onClick={() => navigator.clipboard?.writeText(h)} className="w-7 h-7 rounded-md border border-black/10 shrink-0 cursor-grab active:cursor-grabbing" style={{ background: h }} />
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="text-[10px] text-gray-400">Preenchi as 4 cores — arraste qualquer amostra pra trocar uma delas.</div>
                </div>
              )}
              {erroPal && <div className="text-[11px] text-rose-600 mt-1">{erroPal}</div>}
            </div>
          )}
          <div>
            <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Cores</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {cores.map((c) => (
                <div key={c.k}>
                  <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">{c.label}</label>
                  <div
                    onDragOver={(e) => { e.preventDefault(); if (dropK !== c.k) setDropK(c.k); }}
                    onDragLeave={() => setDropK((k) => (k === c.k ? null : k))}
                    onDrop={(e) => { e.preventDefault(); setDropK(null); const raw = e.dataTransfer.getData("text/plain").trim(); const hex = raw.startsWith("#") ? raw : "#" + raw; if (/^#[0-9a-f]{6}$/i.test(hex)) setC(c.k, hex.toLowerCase()); }}
                    className={"flex items-center gap-2 mt-1 rounded-lg transition-shadow " + (dropK === c.k ? "ring-2 ring-indigo-400 ring-offset-1" : "")}
                  >
                    <input type="color" value={val(c.k) || "#888888"} onChange={(e) => setC(c.k, e.target.value)} disabled={!podeEditar} className="w-10 h-10 shrink-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent p-0.5 cursor-pointer" />
                    <input value={val(c.k)} onChange={(e) => setC(c.k, e.target.value)} placeholder="padrão do tema" disabled={!podeEditar} className="flex-1 min-w-0 h-10 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[12px] font-mono" />
                    {val(c.k) && podeEditar && <button onClick={() => setC(c.k, "")} className="shrink-0 text-[11px] text-gray-400 hover:text-rose-500" title="Limpar (usa o padrão)">limpar</button>}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Fontes</div>
            <div className="space-y-2">
              {fontes.map((f) => (
                <div key={f.k}>
                  <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">{f.label}</label>
                  <select value={val(f.k)} onChange={(e) => setC(f.k, e.target.value)} disabled={!podeEditar} className="w-full h-10 px-2 mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm">
                    <option value="">— padrão do template —</option>
                    {CATEGORIAS.map((cat) => (
                      <optgroup key={cat} label={CATEGORIA_LABEL[cat]}>
                        {FONTES_SITE.filter((ft) => ft.categoria === cat).map((ft) => <option key={ft.id} value={ft.id}>{ft.nome}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">Vazio = usa o padrão do template.</p>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold">Cancelar</button>
          {podeEditar && <button onClick={async () => { setSalvando(true); try { await onSave(t); } catch { setSalvando(false); } }} disabled={salvando} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1">{salvando ? "Salvando…" : <><Check size={15} /> Salvar</>}</button>}
        </div>
      </div>
    </div>
  );
}
