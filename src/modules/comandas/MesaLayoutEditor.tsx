// ════════════════════════════════════════════════════════════════════════════
//  Editor da planta do salão (visão superior). Adiciona MESAS e BLOCOS de
//  referência (calçada, rua, nosso imóvel, vizinhos — nome livre) e ARRASTA
//  cada um pra posição. Coordenadas em % do canvas (0–100). 1 doc por rest.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { X, Plus, Trash2, Square, Circle, Save, Map as MapIcon } from "lucide-react";
import { ouvirLayout, salvarLayout, uid } from "./comandasRepo";
import type { ComandaMesa, ComandaAreaBloco } from "../../core/types";

export function MesaLayoutEditor({ rid, onClose }: { rid: string; onClose: () => void }) {
  const [mesas, setMesas] = useState<ComandaMesa[]>([]);
  const [blocos, setBlocos] = useState<ComandaAreaBloco[]>([]);
  const [sel, setSel] = useState<{ tipo: "mesa" | "bloco"; id: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const carregouRef = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ tipo: "mesa" | "bloco"; id: string; mode: "move" | "resize" } | null>(null);

  // Carrega 1x (não sobrescreve edições com snapshots seguintes).
  useEffect(() => ouvirLayout(rid, (l) => {
    if (carregouRef.current) return;
    setMesas(l?.mesas || []); setBlocos(l?.blocos || []); carregouRef.current = true;
  }), [rid]);

  const selMesa = sel?.tipo === "mesa" ? mesas.find((m) => m.id === sel.id) : null;
  const selBloco = sel?.tipo === "bloco" ? blocos.find((b) => b.id === sel.id) : null;

  function addMesa() {
    const nums = mesas.map((m) => parseInt((m.nome.match(/\d+/) || ["0"])[0], 10)).filter((n) => !isNaN(n));
    const prox = (nums.length ? Math.max(...nums) : 0) + 1;
    const m: ComandaMesa = { id: uid(), nome: `M${prox}`, x: 50, y: 50, w: 11, h: 15, formato: "quad" };
    setMesas((v) => [...v, m]); setSel({ tipo: "mesa", id: m.id });
  }
  function addBloco() {
    const b: ComandaAreaBloco = { id: uid(), nome: "Área", x: 10, y: 10, w: 40, h: 22 };
    setBlocos((v) => [...v, b]); setSel({ tipo: "bloco", id: b.id });
  }
  function del() {
    if (!sel) return;
    if (sel.tipo === "mesa") setMesas((v) => v.filter((m) => m.id !== sel.id));
    else setBlocos((v) => v.filter((b) => b.id !== sel.id));
    setSel(null);
  }
  function renomear(nome: string) {
    if (!sel) return;
    if (sel.tipo === "mesa") setMesas((v) => v.map((m) => m.id === sel.id ? { ...m, nome } : m));
    else setBlocos((v) => v.map((b) => b.id === sel.id ? { ...b, nome } : b));
  }
  function setFormato(f: "quad" | "red") {
    if (sel?.tipo !== "mesa") return;
    setMesas((v) => v.map((m) => m.id === sel.id ? { ...m, formato: f } : m));
  }

  function onDownItem(e: React.PointerEvent, tipo: "mesa" | "bloco", id: string, mode: "move" | "resize") {
    e.stopPropagation(); e.preventDefault();
    dragRef.current = { tipo, id, mode };
    setSel({ tipo, id });
    try { canvasRef.current?.setPointerCapture(e.pointerId); } catch { /* */ }
  }
  function onMove(e: React.PointerEvent) {
    const d = dragRef.current; const r = canvasRef.current?.getBoundingClientRect();
    if (!d || !r) return;
    const px = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    const py = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100));
    if (d.mode === "move") {
      if (d.tipo === "mesa") setMesas((v) => v.map((m) => m.id === d.id ? { ...m, x: +px.toFixed(1), y: +py.toFixed(1) } : m));
      else setBlocos((v) => v.map((b) => b.id === d.id ? { ...b, x: +px.toFixed(1), y: +py.toFixed(1) } : b));
    } else {
      setBlocos((v) => v.map((b) => b.id === d.id ? { ...b, w: Math.max(10, +(px - b.x).toFixed(1)), h: Math.max(8, +(py - b.y).toFixed(1)) } : b));
    }
  }
  function onUp(e: React.PointerEvent) { dragRef.current = null; try { canvasRef.current?.releasePointerCapture(e.pointerId); } catch { /* */ } }

  async function salvar() {
    setSaving(true);
    try { await salvarLayout(rid, mesas, blocos); setMsg("Planta salva ✓"); setTimeout(() => setMsg(""), 2500); }
    catch (err) { setMsg("Falha ao salvar: " + (err instanceof Error ? err.message : "?")); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-3xl p-4 shadow-xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><MapIcon size={16} className="text-indigo-500" /> Editor do salão</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <button onClick={addMesa} className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold inline-flex items-center gap-1"><Plus size={15} /> Mesa</button>
          <button onClick={addBloco} className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold inline-flex items-center gap-1 text-gray-700 dark:text-gray-200"><Plus size={15} /> Área / bloco</button>
          <div className="ml-auto inline-flex items-center gap-2">
            {msg && <span className="text-[12px] text-emerald-600 dark:text-emerald-400">{msg}</span>}
            <button onClick={() => void salvar()} disabled={saving} className="h-9 px-3 rounded-lg bg-emerald-600 text-white text-sm font-bold inline-flex items-center gap-1 disabled:opacity-40"><Save size={15} /> {saving ? "Salvando…" : "Salvar planta"}</button>
          </div>
        </div>
        <p className="text-[11px] text-gray-400 mb-2">Toque pra selecionar · arraste pra posicionar · blocos têm alça no canto pra redimensionar. Visão de cima.</p>

        {/* Canvas (visão superior) */}
        <div ref={canvasRef} onPointerMove={onMove} onPointerUp={onUp} onPointerDown={() => setSel(null)}
          className="relative w-full h-[52vh] rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 overflow-hidden touch-none select-none">
          {blocos.map((b) => {
            const ativo = sel?.tipo === "bloco" && sel.id === b.id;
            return (
              <div key={b.id} onPointerDown={(e) => onDownItem(e, "bloco", b.id, "move")}
                style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}
                className={`absolute rounded-lg border-2 border-dashed ${ativo ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20" : "border-gray-300 dark:border-gray-700 bg-gray-100/50 dark:bg-gray-800/20"} cursor-move`}>
                <span className="absolute top-1 left-1.5 text-[10px] font-semibold text-gray-500 dark:text-gray-400 truncate max-w-[90%] uppercase tracking-wide">{b.nome}</span>
                <div onPointerDown={(e) => onDownItem(e, "bloco", b.id, "resize")} className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize bg-indigo-500/70 rounded-tl-md" title="Redimensionar" />
              </div>
            );
          })}
          {mesas.map((m) => {
            const ativo = sel?.tipo === "mesa" && sel.id === m.id;
            return (
              <div key={m.id} onPointerDown={(e) => onDownItem(e, "mesa", m.id, "move")}
                style={{ left: `${m.x}%`, top: `${m.y}%`, width: `${m.w || 11}%`, height: `${m.h || 15}%`, transform: "translate(-50%,-50%)", borderRadius: m.formato === "red" ? "50%" : "10px" }}
                className={`absolute grid place-items-center text-[12px] font-bold cursor-move border-2 ${ativo ? "border-indigo-600 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-200" : "border-gray-400 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"}`}>
                {m.nome}
              </div>
            );
          })}
          {mesas.length === 0 && blocos.length === 0 && <div className="absolute inset-0 grid place-items-center text-gray-400 text-sm">Adicione mesas e áreas acima</div>}
        </div>

        {/* Painel do item selecionado */}
        {sel && (selMesa || selBloco) && (
          <div className="mt-3 rounded-xl border border-gray-200 dark:border-gray-800 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-gray-500 dark:text-gray-400 shrink-0">{sel.tipo === "mesa" ? "Mesa" : "Bloco"}:</span>
              <input value={(selMesa || selBloco)!.nome} onChange={(e) => renomear(e.target.value)} className="flex-1 h-9 px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100" placeholder={sel.tipo === "mesa" ? "nome da mesa" : "ex.: Calçada, Rua, Vizinho — Padaria"} />
              <button onClick={del} className="h-9 px-3 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-sm font-semibold inline-flex items-center gap-1"><Trash2 size={14} /> Excluir</button>
            </div>
            {selMesa && (
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-gray-500 dark:text-gray-400">Formato:</span>
                <button onClick={() => setFormato("quad")} className={`h-8 px-3 rounded-lg border text-[12px] font-semibold inline-flex items-center gap-1 ${selMesa.formato !== "red" ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}><Square size={13} /> Quadrada</button>
                <button onClick={() => setFormato("red")} className={`h-8 px-3 rounded-lg border text-[12px] font-semibold inline-flex items-center gap-1 ${selMesa.formato === "red" ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}><Circle size={13} /> Redonda</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
