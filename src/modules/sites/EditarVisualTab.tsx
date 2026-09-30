// Edição visual do site: o preview É a tela de edição. Clica num texto do
// preview → abre um modal com os campos daquela seção → salva no sitesConfig.
// O preview roda num iframe (/site-preview/:rid?edit=1) pra isolar o estilo do
// site; o clique chega por postMessage.
import { useEffect, useMemo, useState } from "react";
import { Monitor, Smartphone, X, Sparkles, Check, MousePointerClick } from "lucide-react";
import { useAuth } from "../../core/auth/AuthContext";
import { auth } from "../../core/firebase/config";
import { useSiteConfig } from "./useSiteConfig";
import type { SiteConfig } from "../../core/types";

type Campo = { campo: string; label: string; tipo: "top" | "texto"; multi?: boolean };
type Grupo = { titulo: string; campos: Campo[] };

// Grupos ligados aos data-grupo do template (hero, seções por id, rodape).
const GRUPOS: Record<string, Grupo> = {
  hero: { titulo: "Topo (hero)", campos: [
    { campo: "slogan", label: "Slogan (linha acima do título)", tipo: "top" },
    { campo: "heroTitulo", label: "Título principal", tipo: "texto", multi: true },
    { campo: "heroSubtitulo", label: "Subtítulo", tipo: "texto", multi: true },
    { campo: "heroCtaLabel", label: "Rótulo do botão", tipo: "texto" },
  ] },
  historia: { titulo: "Sobre", campos: [
    { campo: "historiaTitulo", label: "Título da seção", tipo: "texto" },
    { campo: "historia", label: "Texto", tipo: "top", multi: true },
  ] },
  cardapio: { titulo: "Cardápio", campos: [{ campo: "cardapioTitulo", label: "Título da seção", tipo: "texto" }] },
  horario: { titulo: "Horário", campos: [
    { campo: "horarioTitulo", label: "Título da seção", tipo: "texto" },
    { campo: "horarioProximosAvisosLabel", label: "Rótulo 'próximos avisos'", tipo: "texto" },
  ] },
  laje: { titulo: "Eventos na Laje", campos: [
    { campo: "lajeTitulo", label: "Título", tipo: "texto" },
    { campo: "lajeTexto", label: "Texto", tipo: "texto", multi: true },
    { campo: "lajeCtaLabel", label: "Rótulo do botão", tipo: "texto" },
  ] },
  eventos: { titulo: "Eventos privados", campos: [
    { campo: "eventosTitulo", label: "Título", tipo: "texto" },
    { campo: "eventosTexto", label: "Texto", tipo: "texto", multi: true },
    { campo: "eventosCtaLabel", label: "Rótulo do botão", tipo: "texto" },
  ] },
  reservas: { titulo: "Reservas", campos: [
    { campo: "reservasTitulo", label: "Título", tipo: "texto" },
    { campo: "reservasTexto", label: "Texto", tipo: "texto", multi: true },
    { campo: "reservasCtaLabel", label: "Rótulo do botão", tipo: "texto" },
  ] },
  delivery: { titulo: "Delivery", campos: [
    { campo: "deliveryTitulo", label: "Título", tipo: "texto" },
    { campo: "deliveryTexto", label: "Texto", tipo: "texto", multi: true },
  ] },
  trabalhe: { titulo: "Trabalhe conosco", campos: [
    { campo: "trabalheTitulo", label: "Título", tipo: "texto" },
    { campo: "trabalheTexto", label: "Texto", tipo: "texto", multi: true },
    { campo: "trabalheCtaLabel", label: "Rótulo do botão", tipo: "texto" },
  ] },
  contato: { titulo: "Contato", campos: [{ campo: "contatoTitulo", label: "Título da seção", tipo: "texto" }] },
  rodape: { titulo: "Rodapé", campos: [{ campo: "rodapeDireitos", label: "Direitos (após © ano)", tipo: "texto" }] },
};

function valorAtual(config: SiteConfig | null, c: Campo): string {
  if (!config) return "";
  if (c.tipo === "top") return String((config as unknown as Record<string, unknown>)[c.campo] ?? "");
  return String(config.textos?.[c.campo as keyof NonNullable<SiteConfig["textos"]>] ?? "");
}

export function EditarVisualTab({ rid, nomeRestaurante, podeEditar }: { rid: string; nomeRestaurante: string; podeEditar: boolean }) {
  const { pessoa: me } = useAuth();
  const { config, save } = useSiteConfig(rid, nomeRestaurante);
  const [grupoId, setGrupoId] = useState<string | null>(null);
  const [vp, setVp] = useState<"desktop" | "mobile">("desktop");

  // Recebe o clique do iframe (postMessage) e abre o modal.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; grupo?: string };
      if (d?.type === "site-edit-pick" && d.grupo && GRUPOS[d.grupo]) setGrupoId(d.grupo);
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[13px] text-gray-600 dark:text-gray-300 inline-flex items-center gap-1.5"><MousePointerClick size={15} className="text-indigo-500" /> Clique num texto do site pra editar.</div>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
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

      {grupoId && GRUPOS[grupoId] && (
        <GrupoModal
          grupo={GRUPOS[grupoId]} config={config} podeEditar={podeEditar}
          onClose={() => setGrupoId(null)}
          onSave={async (vals) => {
            const parcial: Record<string, unknown> = {};
            const textos: Record<string, string> = { ...(config?.textos || {}) };
            for (const c of GRUPOS[grupoId].campos) {
              const v = vals[c.campo] ?? "";
              if (c.tipo === "top") parcial[c.campo] = v;
              else textos[c.campo] = v;
            }
            parcial.textos = textos;
            await save(parcial as Partial<SiteConfig>, me?.id || "");
            setGrupoId(null);
          }}
        />
      )}
    </div>
  );
}

function GrupoModal({ grupo, config, podeEditar, onClose, onSave }: {
  grupo: Grupo; config: SiteConfig | null; podeEditar: boolean;
  onClose: () => void; onSave: (vals: Record<string, string>) => Promise<void>;
}) {
  const inicial = useMemo(() => {
    const o: Record<string, string> = {};
    grupo.campos.forEach((c) => { o[c.campo] = valorAtual(config, c); });
    return o;
  }, [grupo, config]);
  const [vals, setVals] = useState<Record<string, string>>(inicial);
  const [salvando, setSalvando] = useState(false);
  const [iaCampo, setIaCampo] = useState("");
  const [erro, setErro] = useState("");

  async function melhorar(campo: string, label: string) {
    setIaCampo(campo); setErro("");
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const r = await fetch("/api/sites-ia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken, modo: "campo", campo: label, texto: vals[campo] || "", instrucao: "Melhore o texto, mais claro e elegante, mantendo o sentido." }) });
      const j = await r.json();
      if (r.ok && j?.resultado?.texto) setVals((v) => ({ ...v, [campo]: String(j.resultado.texto) }));
      else setErro(j?.error || "A IA não conseguiu melhorar.");
    } catch (e) { setErro("Falha na IA: " + (e instanceof Error ? e.message : "erro")); }
    finally { setIaCampo(""); }
  }

  const inp = "w-full px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm";

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-[520px] max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2">
          <div className="font-extrabold text-[15px]">Editar · {grupo.titulo}</div>
          <div className="flex-1" />
          <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"><X size={16} /></button>
        </div>
        <div className="p-4 overflow-auto space-y-3">
          {grupo.campos.map((c) => (
            <div key={c.campo}>
              <div className="flex items-center gap-2 mb-1">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">{c.label}</label>
                <div className="flex-1" />
                {podeEditar && c.multi && <button type="button" onClick={() => void melhorar(c.campo, c.label)} disabled={iaCampo === c.campo} className="text-[11px] font-bold text-indigo-600 dark:text-indigo-300 inline-flex items-center gap-1 disabled:opacity-50"><Sparkles size={11} /> {iaCampo === c.campo ? "…" : "melhorar"}</button>}
              </div>
              {c.multi
                ? <textarea value={vals[c.campo] || ""} onChange={(e) => setVals((v) => ({ ...v, [c.campo]: e.target.value }))} disabled={!podeEditar} className={inp + " py-2"} rows={c.campo === "historia" ? 6 : 3} />
                : <input value={vals[c.campo] || ""} onChange={(e) => setVals((v) => ({ ...v, [c.campo]: e.target.value }))} disabled={!podeEditar} className={inp + " h-10"} />}
            </div>
          ))}
          {erro && <div className="text-[12px] text-rose-600">{erro}</div>}
        </div>
        <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold">Cancelar</button>
          {podeEditar && <button onClick={async () => { setSalvando(true); try { await onSave(vals); } catch (e) { setErro("Falha ao salvar: " + (e instanceof Error ? e.message : "erro")); setSalvando(false); } }} disabled={salvando} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1">{salvando ? "Salvando…" : <><Check size={15} /> Salvar</>}</button>}
        </div>
      </div>
    </div>
  );
}
