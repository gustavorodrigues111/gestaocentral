// Edição visual do site: o preview É a tela de edição. Clica num texto/imagem
// do preview → abre o modal certo (texto campo-a-campo, imagem ou cores) →
// salva no sitesConfig. Preview num iframe (/site-preview/:rid?edit=1) pra
// isolar o estilo; o clique chega por postMessage.
import { useEffect, useState } from "react";
import { Monitor, Smartphone, X, Sparkles, Check, MousePointerClick, Palette, Image as ImageIcon } from "lucide-react";
import { useAuth } from "../../core/auth/AuthContext";
import { auth } from "../../core/firebase/config";
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
        <AssetModal rid={rid} asset={sel.asset} url={String((config as unknown as Record<string, unknown>)[ASSET_INFO[sel.asset].campo] || "")} podeEditar={podeEditar} onClose={() => setSel(null)} onChange={(u) => void salvarAsset(sel.asset, u)} />
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
function AssetModal({ rid, asset, url, podeEditar, onClose, onChange }: {
  rid: string; asset: SelAsset["asset"]; url: string; podeEditar: boolean;
  onClose: () => void; onChange: (url: string) => void;
}) {
  const info = ASSET_INFO[asset];
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-[480px] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3"><div className="font-extrabold text-[15px]">{info.label}</div><div className="flex-1" /><button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"><X size={16} /></button></div>
        <UploadImagem rid={rid} tipo={info.tipo} label={info.label} descricao={info.desc} url={url} onChange={onChange} disabled={!podeEditar} />
        <div className="flex justify-end mt-4"><button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold">Fechar</button></div>
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
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-[440px] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3"><Palette size={18} className="text-indigo-500" /><div className="font-extrabold text-[15px]">Cores & fontes</div><div className="flex-1" /><button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"><X size={16} /></button></div>
        <div className="max-h-[62vh] overflow-auto pr-1 space-y-4">
          {podeEditar && (logoUrl || heroImagemUrl) && (
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20 p-3">
              <div className="text-[11px] font-bold text-indigo-800 dark:text-indigo-200 uppercase tracking-wide mb-1.5 inline-flex items-center gap-1"><Sparkles size={12} /> Sugerir cores da imagem</div>
              <div className="flex flex-wrap gap-2">
                {logoUrl && <button type="button" onClick={() => void sugerir(logoUrl, "logo")} disabled={!!extraindo} className="text-[12px] font-semibold px-3 h-8 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-900 disabled:opacity-50">{extraindo === "logo" ? "Analisando…" : "Da logo"}</button>}
                {heroImagemUrl && <button type="button" onClick={() => void sugerir(heroImagemUrl, "hero")} disabled={!!extraindo} className="text-[12px] font-semibold px-3 h-8 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-900 disabled:opacity-50">{extraindo === "hero" ? "Analisando…" : "Da imagem de fundo"}</button>}
              </div>
              {palette.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] text-gray-500 mb-1">Paleta encontrada (clique pra copiar o código):</div>
                  <div className="flex flex-wrap gap-1.5">
                    {palette.map((h) => (
                      <button key={h} type="button" title={`${h} — clique pra copiar`} onClick={() => navigator.clipboard?.writeText(h)} className="w-7 h-7 rounded-md border border-black/10 shrink-0" style={{ background: h }} />
                    ))}
                  </div>
                  <div className="text-[10px] text-gray-400 mt-1">Preenchi as 4 cores abaixo — ajuste como quiser.</div>
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
                  <div className="flex items-center gap-2 mt-1">
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
