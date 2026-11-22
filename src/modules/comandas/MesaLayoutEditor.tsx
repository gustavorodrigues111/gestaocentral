// ════════════════════════════════════════════════════════════════════════════
//  Cadastro de LOCAIS e MESAS do Comandas. Sem planta/arrastar — só duas listas.
//  Os LOCAIS (áreas: Calçada, Una Vinhos, Balcão…) viram a opção obrigatória de
//  "Local / referência" ao abrir a comanda. As MESAS são opção extra.
//  Guardado no mesmo doc 1-por-rest (comandaLayout/{rid}); x/y/w/h não são mais
//  usados (ficam 0), mantidos só pra não quebrar o schema.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { X, Plus, Trash2, Save, MapPin, Utensils } from "lucide-react";
import { ouvirLayout, salvarLayout, uid } from "./comandasRepo";
import type { ComandaMesa, ComandaAreaBloco } from "../../core/types";

export function MesaLayoutEditor({ rid, onClose }: { rid: string; onClose: () => void }) {
  const [mesas, setMesas] = useState<ComandaMesa[]>([]);
  const [blocos, setBlocos] = useState<ComandaAreaBloco[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const carregouRef = useRef(false);

  // Carrega 1x (não sobrescreve edições com snapshots seguintes).
  useEffect(() => ouvirLayout(rid, (l) => {
    if (carregouRef.current) return;
    setMesas(l?.mesas || []); setBlocos(l?.blocos || []); carregouRef.current = true;
  }), [rid]);

  const addLocal = () => setBlocos((v) => [...v, { id: uid(), nome: "", x: 0, y: 0, w: 0, h: 0 }]);
  const addMesa = () => {
    const nums = mesas.map((m) => parseInt((m.nome.match(/\d+/) || ["0"])[0], 10)).filter((n) => !isNaN(n));
    const prox = (nums.length ? Math.max(...nums) : 0) + 1;
    setMesas((v) => [...v, { id: uid(), nome: `M${prox}`, x: 0, y: 0 }]);
  };
  const renLocal = (id: string, nome: string) => setBlocos((v) => v.map((b) => (b.id === id ? { ...b, nome } : b)));
  const renMesa = (id: string, nome: string) => setMesas((v) => v.map((m) => (m.id === id ? { ...m, nome } : m)));
  const delLocal = (id: string) => setBlocos((v) => v.filter((b) => b.id !== id));
  const delMesa = (id: string) => setMesas((v) => v.filter((m) => m.id !== id));

  async function salvar() {
    setSaving(true);
    try {
      const m2 = mesas.map((m) => ({ ...m, nome: m.nome.trim() })).filter((m) => m.nome);
      const b2 = blocos.map((b) => ({ ...b, nome: b.nome.trim() })).filter((b) => b.nome);
      await salvarLayout(rid, m2, b2);
      setMesas(m2); setBlocos(b2);
      setMsg("Salvo ✓"); setTimeout(() => setMsg(""), 2500);
    } catch (err) { setMsg("Falha ao salvar: " + (err instanceof Error ? err.message : "?")); }
    finally { setSaving(false); }
  }

  const lista = (items: { id: string; nome: string }[], ren: (id: string, n: string) => void, del: (id: string) => void, ph: string, autoId?: string) => (
    <div className="space-y-1.5">
      {items.length === 0 && <div className="text-[12px] text-gray-400 py-1">Nenhum ainda.</div>}
      {items.map((it) => (
        <div key={it.id} className="flex items-center gap-2">
          <input value={it.nome} autoFocus={it.id === autoId} onChange={(e) => ren(it.id, e.target.value)} placeholder={ph}
            className="flex-1 h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100" />
          <button onClick={() => del(it.id)} className="h-10 w-10 grid place-items-center rounded-lg border border-rose-200 dark:border-rose-900/50 text-rose-500 active:bg-rose-50 dark:active:bg-rose-950/30"><Trash2 size={16} /></button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md p-4 shadow-xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><MapPin size={16} className="text-indigo-500" /> Locais e mesas</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <p className="text-[11px] text-gray-400 mb-3">Os <b>locais</b> viram a opção de "Local / referência" (obrigatória) ao abrir a comanda. As <b>mesas</b> ficam como opção extra.</p>

        <div className="space-y-4">
          <section>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[13px] font-bold text-gray-800 dark:text-gray-100 inline-flex items-center gap-1.5"><MapPin size={14} className="text-indigo-500" /> Locais / áreas</span>
              <button onClick={addLocal} className="h-8 px-2.5 rounded-lg bg-indigo-600 text-white text-[12px] font-semibold inline-flex items-center gap-1"><Plus size={14} /> Local</button>
            </div>
            {lista(blocos, renLocal, delLocal, "ex.: Calçada · Una Vinhos · Balcão", blocos[blocos.length - 1]?.nome === "" ? blocos[blocos.length - 1]?.id : undefined)}
          </section>
          <section>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[13px] font-bold text-gray-800 dark:text-gray-100 inline-flex items-center gap-1.5"><Utensils size={14} className="text-indigo-500" /> Mesas</span>
              <button onClick={addMesa} className="h-8 px-2.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-[12px] font-semibold inline-flex items-center gap-1"><Plus size={14} /> Mesa</button>
            </div>
            {lista(mesas, renMesa, delMesa, "ex.: M1 · Mesa 5")}
          </section>
        </div>

        <div className="flex items-center gap-2 pt-4 mt-3 border-t border-gray-200 dark:border-gray-800">
          {msg && <span className="text-[12px] text-emerald-600 dark:text-emerald-400">{msg}</span>}
          <button onClick={onClose} className="ml-auto h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200">Fechar</button>
          <button onClick={() => void salvar()} disabled={saving} className="h-10 px-4 rounded-lg bg-emerald-600 text-white text-sm font-bold inline-flex items-center gap-1 disabled:opacity-40"><Save size={15} /> {saving ? "Salvando…" : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}
