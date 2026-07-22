// 📓 CADERNO — log/bloco de notas de tudo que foi solicitado e o que falta, por
// módulo, marcando feito/pendente e com responsável (Você / IA / outro). Ordem =
// a mesma do menu do planejamento.app (por área). Substitui o antigo mapa de
// arquitetura. Rota /arquitetura (mestre).
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { MODULES, AREA_INFO, getModule } from "../../config/modules";
import type { CadernoItem, ModuleArea } from "../../core/types";
import { ouvirCaderno, merge, salvarItem, toggleStatus, excluirItem } from "./cadernoRepo";

const AREA_ORDER: ModuleArea[] = ["planejamento", "ops", "dp", "fin", "inst", "master"];
// Ordem dos módulos = ordem do menu (por área, na ordem do array MODULES). "geral" primeiro.
const MODULO_ORDER: string[] = ["geral", ...AREA_ORDER.flatMap((a) => MODULES.filter((m) => m.area === a).map((m) => m.id))];
const ordemDe = (id: string) => { const i = MODULO_ORDER.indexOf(id); return i < 0 ? 999 : i; };

function metaModulo(id: string): { label: string; icon: string; area?: ModuleArea } {
  if (id === "geral") return { label: "Geral / infra", icon: "🗒️" };
  const m = getModule(id);
  return m ? { label: m.label, icon: m.icon, area: m.area } : { label: id, icon: "•" };
}

const uid = () => Math.random().toString(36).slice(2, 11);

function RespBadge({ r }: { r: string }) {
  if (r === "ia") return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">🤖 IA</span>;
  if (r === "gustavo") return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">🧑 Você</span>;
  return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">👤 {r}</span>;
}

export function ArquiteturaPage() {
  const { pessoa: me } = useAuth();
  const [fs, setFs] = useState<Record<string, CadernoItem>>({});
  const [respFiltro, setRespFiltro] = useState<"todos" | "gustavo" | "ia">("todos");
  const [soPendentes, setSoPendentes] = useState(true);
  const [addModulo, setAddModulo] = useState<string | null>(null);
  const [addTitulo, setAddTitulo] = useState("");
  const [addResp, setAddResp] = useState("gustavo");

  useEffect(() => ouvirCaderno(setFs), []);

  const itens = useMemo(() => merge(fs), [fs]);
  const pendentesTotal = itens.filter((i) => i.status === "pendente").length;

  const visiveis = useMemo(() => itens.filter((i) => {
    if (soPendentes && i.status !== "pendente") return false;
    if (respFiltro !== "todos" && i.responsavel !== respFiltro) return false;
    return true;
  }), [itens, soPendentes, respFiltro]);

  const grupos = useMemo(() => {
    const byMod: Record<string, CadernoItem[]> = {};
    for (const i of visiveis) (byMod[i.moduloId] ||= []).push(i);
    return Object.keys(byMod)
      .sort((a, b) => ordemDe(a) - ordemDe(b))
      .map((mod) => ({ mod, itens: byMod[mod].slice().sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)) }));
  }, [visiveis]);

  async function adicionar(mod: string) {
    if (!addTitulo.trim()) return;
    await salvarItem({
      id: uid(), moduloId: mod, titulo: addTitulo.trim(), status: "pendente",
      responsavel: addResp, criadoEm: new Date().toISOString(), criadoPor: me?.id || null,
      ordem: Date.now(), origem: "manual",
    });
    setAddTitulo(""); setAddModulo(null);
  }
  async function editarTitulo(item: CadernoItem) {
    const t = prompt("Editar item:", item.titulo);
    if (t === null || !t.trim()) return;
    await salvarItem({ ...item, titulo: t.trim() });
  }
  async function ciclarResp(item: CadernoItem) {
    const prox = item.responsavel === "gustavo" ? "ia" : "gustavo";
    await salvarItem({ ...item, responsavel: prox });
  }

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">📓 Caderno</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Tudo que foi feito e o que falta, por módulo. <b className="text-rose-600 dark:text-rose-400">{pendentesTotal} pendente(s)</b>.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
            {(["todos", "gustavo", "ia"] as const).map((r) => (
              <button key={r} type="button" onClick={() => setRespFiltro(r)}
                className={`px-3 py-1 text-xs font-medium rounded-md ${respFiltro === r ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm" : "text-gray-500 dark:text-gray-400"}`}>
                {r === "todos" ? "Todos" : r === "gustavo" ? "Você" : "IA"}
              </button>
            ))}
          </div>
          <label className="text-xs text-gray-600 dark:text-gray-300 inline-flex items-center gap-1.5">
            <input type="checkbox" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)} /> só pendentes
          </label>
        </div>
      </header>

      {grupos.length === 0 && <p className="text-sm text-gray-400 py-10 text-center">Nada por aqui com esse filtro. 🎉</p>}

      {grupos.map(({ mod, itens: its }) => {
        const meta = metaModulo(mod);
        const cor = meta.area ? AREA_INFO[meta.area]?.color : "#6b7280";
        return (
          <section key={mod} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
              <span className="text-base">{meta.icon}</span>
              <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">{meta.label}</span>
              <span className="w-2 h-2 rounded-full" style={{ background: cor }} />
              <span className="text-[11px] text-gray-400 tabular-nums">{its.filter((i) => i.status === "pendente").length} pend.</span>
              <button type="button" onClick={() => { setAddModulo(addModulo === mod ? null : mod); setAddTitulo(""); }} className="ml-auto text-xs text-indigo-600 dark:text-indigo-400 hover:underline">+ item</button>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {its.map((item) => {
                const feito = item.status === "feito";
                return (
                  <div key={item.id} className="flex items-start gap-2.5 px-3 py-2.5">
                    <button type="button" onClick={() => void toggleStatus(item)} title={feito ? "Reabrir" : "Marcar feito"}
                      className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 text-xs ${feito ? "bg-emerald-600 border-emerald-600 text-white" : "border-gray-300 dark:border-gray-600 text-transparent hover:border-emerald-400"}`}>✓</button>
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm ${feito ? "line-through text-gray-400 dark:text-gray-500" : "text-gray-800 dark:text-gray-100"}`}>{item.titulo}</div>
                      {item.descricao && <div className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">{item.descricao}</div>}
                    </div>
                    <button type="button" onClick={() => void ciclarResp(item)} title="Trocar responsável (Você ↔ IA)"><RespBadge r={item.responsavel} /></button>
                    <button type="button" onClick={() => void editarTitulo(item)} className="text-gray-300 hover:text-gray-600 text-xs px-1" title="Editar">✎</button>
                    <button type="button" onClick={() => { if (confirm("Excluir este item?")) void excluirItem(item.id); }} className="text-gray-300 hover:text-rose-500 text-xs px-1" title="Excluir">🗑</button>
                  </div>
                );
              })}
              {addModulo === mod && (
                <div className="px-3 py-2.5 bg-gray-50 dark:bg-gray-800/40 flex items-center gap-2 flex-wrap">
                  <input autoFocus value={addTitulo} onChange={(e) => setAddTitulo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void adicionar(mod)}
                    placeholder="Novo item…" className="flex-1 min-w-[180px] text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5" />
                  <select value={addResp} onChange={(e) => setAddResp(e.target.value)} className="text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5">
                    <option value="gustavo">Você</option>
                    <option value="ia">IA</option>
                  </select>
                  <Button size="sm" onClick={() => void adicionar(mod)} disabled={!addTitulo.trim()}>Adicionar</Button>
                </div>
              )}
            </div>
          </section>
        );
      })}

      {/* Adicionar item num módulo que ainda não aparece */}
      <details className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-3">
        <summary className="text-sm text-gray-600 dark:text-gray-300 cursor-pointer">+ Adicionar item em outro módulo</summary>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <select value={addModulo || ""} onChange={(e) => setAddModulo(e.target.value || null)} className="text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5">
            <option value="">— módulo —</option>
            {["geral", ...MODULO_ORDER.filter((m) => m !== "geral")].map((m) => <option key={m} value={m}>{metaModulo(m).icon} {metaModulo(m).label}</option>)}
          </select>
          <input value={addTitulo} onChange={(e) => setAddTitulo(e.target.value)} placeholder="Novo item…" className="flex-1 min-w-[180px] text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5" />
          <select value={addResp} onChange={(e) => setAddResp(e.target.value)} className="text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5">
            <option value="gustavo">Você</option><option value="ia">IA</option>
          </select>
          <Button size="sm" disabled={!addModulo || !addTitulo.trim()} onClick={() => addModulo && void adicionar(addModulo)}>Adicionar</Button>
        </div>
      </details>
    </div>
  );
}
