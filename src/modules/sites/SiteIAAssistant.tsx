// Assistente de IA do módulo Sites — gera o conteúdo editorial inteiro
// (slogan, hero, história) a partir de nome/tipo/tom e aplica no sitesConfig.
// Nada publica sozinho: mostra o gerado pra revisar e o usuário escolhe aplicar.
import { useState } from "react";
import { Sparkles, X, Check, Mic, Square } from "lucide-react";
import { useAuth } from "../../core/auth/AuthContext";
import { auth } from "../../core/firebase/config";
import { useDitado } from "../../core/hooks/useDitado";
import { useSiteConfig } from "./useSiteConfig";

type Gerado = { slogan?: string; heroTitulo?: string; heroSubtitulo?: string; heroCtaLabel?: string; historiaTitulo?: string; historia?: string };
const TONS = ["Acolhedor", "Sofisticado", "Descontraído", "Praiano", "Rústico", "Moderno"];
const CAMPOS: { k: keyof Gerado; label: string; long?: boolean }[] = [
  { k: "slogan", label: "Slogan" },
  { k: "heroTitulo", label: "Chamada principal (hero)" },
  { k: "heroSubtitulo", label: "Subtítulo do hero", long: true },
  { k: "heroCtaLabel", label: "Rótulo do botão" },
  { k: "historiaTitulo", label: "Título da seção Sobre" },
  { k: "historia", label: "Texto Sobre", long: true },
];

export function SiteIAAssistant({ rid, nomeRestaurante, onClose }: { rid: string; nomeRestaurante: string; onClose: () => void }) {
  const { pessoa: me } = useAuth();
  const { config, save } = useSiteConfig(rid, nomeRestaurante);
  const [nome, setNome] = useState(nomeRestaurante);
  const [tipoCozinha, setTipo] = useState("");
  const [tom, setTom] = useState("Acolhedor");
  const dit = useDitado();   // briefing por voz — dit.transcricao é o buffer
  const [gerando, setGerando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [ger, setGer] = useState<Gerado | null>(null);
  const [sel, setSel] = useState<Record<string, boolean>>({});

  async function gerar() {
    if (dit.gravando) dit.parar();
    const briefing = (dit.transcricao + " " + dit.parcial).replace(/\s+/g, " ").trim();
    setGerando(true); setErro(""); setGer(null);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const r = await fetch("/api/sites-ia", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, modo: "site", nome, tipoCozinha, tom, cidade: config?.endereco?.cidade || "", briefing }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j?.error || "A IA não conseguiu gerar."); return; }
      const g = (j.resultado || {}) as Gerado;
      setGer(g);
      const s: Record<string, boolean> = {};
      CAMPOS.forEach((c) => { if (g[c.k]) s[c.k] = true; });
      setSel(s);
    } catch (e) { setErro("Falha na IA: " + (e instanceof Error ? e.message : "erro")); }
    finally { setGerando(false); }
  }

  function setCampo(k: keyof Gerado, v: string) { setGer((g) => ({ ...(g || {}), [k]: v })); }

  async function aplicar() {
    if (!ger) return;
    setSalvando(true); setErro("");
    try {
      const textosAtual = config?.textos || {};
      const parcial: Record<string, unknown> = {};
      if (sel.slogan && ger.slogan) parcial.slogan = ger.slogan;
      if (sel.historia && ger.historia) parcial.historia = ger.historia;
      const textos: Record<string, string> = { ...textosAtual };
      if (sel.heroTitulo && ger.heroTitulo) textos.heroTitulo = ger.heroTitulo;
      if (sel.heroSubtitulo && ger.heroSubtitulo) textos.heroSubtitulo = ger.heroSubtitulo;
      if (sel.heroCtaLabel && ger.heroCtaLabel) textos.heroCtaLabel = ger.heroCtaLabel;
      if (sel.historiaTitulo && ger.historiaTitulo) textos.historiaTitulo = ger.historiaTitulo;
      parcial.textos = textos;
      await save(parcial, me?.id || "");
      onClose();
    } catch (e) { setErro("Falha ao aplicar: " + (e instanceof Error ? e.message : "erro")); setSalvando(false); }
  }

  const inp = "w-full h-10 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm";
  const lbl = "text-[11px] font-bold text-gray-500 uppercase tracking-wide";
  const algumSel = Object.values(sel).some(Boolean);

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-[600px] max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2">
          <Sparkles size={18} className="text-indigo-500" />
          <div className="font-extrabold text-[15px]">Assistente de IA — conteúdo do site</div>
          <div className="flex-1" />
          <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"><X size={16} /></button>
        </div>

        <div className="p-4 overflow-auto space-y-3">
          {!ger && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className={lbl}>Nome</label><input value={nome} onChange={(e) => setNome(e.target.value)} className={inp + " mt-1"} /></div>
                <div><label className={lbl}>Tipo de cozinha (opcional)</label><input value={tipoCozinha} onChange={(e) => setTipo(e.target.value)} placeholder="Frutos do mar, contemporânea…" className={inp + " mt-1"} /></div>
              </div>
              <div>
                <label className={lbl}>Tom de voz</label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {TONS.map((t) => <button key={t} type="button" onClick={() => setTom(t)} className={"text-[12px] px-3 py-1.5 rounded-full border " + (tom === t ? "bg-indigo-600 border-indigo-600 text-white" : "border-gray-200 dark:border-gray-700")}>{t}</button>)}
                </div>
              </div>

              {/* Briefing por voz (ou texto) — a estrela */}
              <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-950/20 p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={lbl}>Briefing — conte sobre o restaurante</span>
                  <div className="flex-1" />
                  {dit.gravando
                    ? <button type="button" onClick={dit.parar} className="text-[12px] font-bold px-3 py-1.5 rounded-full bg-rose-600 text-white inline-flex items-center gap-1.5"><Square size={12} /> Parar</button>
                    : <button type="button" onClick={dit.iniciar} className="text-[12px] font-bold px-3 py-1.5 rounded-full bg-indigo-600 text-white inline-flex items-center gap-1.5"><Mic size={13} /> Gravar</button>}
                </div>
                <textarea
                  value={dit.transcricao + (dit.parcial ? (dit.transcricao ? " " : "") + dit.parcial : "")}
                  onChange={(e) => { dit.setTranscricao(e.target.value); dit.setParcial(""); }}
                  placeholder="Fale (ou escreva) livremente: o que é o lugar, a proposta, a vibe, os pratos que são a cara da casa, o público, a história… A IA transforma isso nas chamadas e textos do site."
                  className={inp + " h-auto py-2"} rows={6}
                />
                {dit.gravando && <div className="text-[11px] text-rose-600 mt-1 inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" /> Gravando… pode falar</div>}
                {dit.erroMic && <div className="text-[11px] text-amber-600 mt-1">{dit.erroMic}</div>}
                <div className="text-[11px] text-gray-400 mt-1">Dica: fale como se estivesse me contando por áudio. Quanto mais contexto, melhor o site sai.</div>
              </div>
              {erro && <div className="text-[12px] text-rose-600">{erro}</div>}
            </>
          )}

          {ger && (
            <>
              <div className="text-[12px] text-gray-500">Revise e marque o que aplicar. Nada publica sozinho.</div>
              {CAMPOS.map((c) => ger[c.k] != null && (
                <div key={c.k} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                  <label className="flex items-center gap-2 mb-1.5">
                    <input type="checkbox" checked={!!sel[c.k]} onChange={(e) => setSel((s) => ({ ...s, [c.k]: e.target.checked }))} />
                    <span className={lbl}>{c.label}</span>
                  </label>
                  {c.long
                    ? <textarea value={ger[c.k] || ""} onChange={(e) => setCampo(c.k, e.target.value)} className={inp + " h-auto py-2"} rows={c.k === "historia" ? 5 : 2} />
                    : <input value={ger[c.k] || ""} onChange={(e) => setCampo(c.k, e.target.value)} className={inp} />}
                </div>
              ))}
              {erro && <div className="text-[12px] text-rose-600">{erro}</div>}
            </>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex items-center gap-2">
          {ger && <button onClick={() => setGer(null)} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold">← Refazer</button>}
          <div className="flex-1" />
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold">Cancelar</button>
          {!ger
            ? <button onClick={() => void gerar()} disabled={gerando || !nome.trim()} className="px-4 py-2 rounded-lg text-white text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1" style={{ background: "linear-gradient(90deg,#6d5efc,#9b6bff)" }}>{gerando ? "Gerando…" : <><Sparkles size={14} /> Gerar conteúdo</>}</button>
            : <button onClick={() => void aplicar()} disabled={salvando || !algumSel} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1">{salvando ? "Aplicando…" : <><Check size={15} /> Aplicar selecionados</>}</button>}
        </div>
      </div>
    </div>
  );
}
