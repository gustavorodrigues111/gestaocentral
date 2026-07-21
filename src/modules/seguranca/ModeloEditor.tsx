// Editor do checklist-modelo (cadastro/edição). Checklist ÚNICO: cada item é
// de UMA área. A mesma pergunta pode valer pra 2 áreas → botão "duplicar" cria
// uma cópia pra atribuir a outra área. Também edita blocos e faixas.
// Edição em estado local; "Salvar" persiste. Requer permissão `configurar`.
import { useState } from "react";
import { Button } from "../../core/ui/Button";
import type { Area, SegurancaFaixa, SegurancaItem, SegurancaModelo } from "../../core/types";
import { AREAS } from "../../core/types";
import { salvarModelo } from "./repository";

const uid = () => Math.random().toString(36).slice(2, 11);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function ModeloEditor({ modelo, onClose }: { modelo: SegurancaModelo; onClose: () => void }) {
  const [m, setM] = useState<SegurancaModelo>(() => clone(modelo));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [dirty, setDirty] = useState(false);

  const blocos = m.blocos.slice().sort((a, b) => a.ordem - b.ordem);
  function mut(fn: (d: SegurancaModelo) => void) { setM((prev) => { const d = clone(prev); fn(d); return d; }); setDirty(true); }

  // ── Itens ──
  const itensDoBloco = (bid: string) => m.itens.filter((i) => i.blocoId === bid).sort((a, b) => a.ordem - b.ordem);
  function addItem(bid: string) {
    mut((d) => { const max = Math.max(0, ...d.itens.filter((i) => i.blocoId === bid).map((i) => i.ordem)); d.itens.push({ id: uid(), texto: "", blocoId: bid, area: "Cozinha", ordem: max + 1, pontua: true }); });
  }
  function updItem(id: string, patch: Partial<SegurancaItem>) { mut((d) => { const i = d.itens.find((x) => x.id === id); if (i) Object.assign(i, patch); }); }
  function delItem(id: string) { mut((d) => { d.itens = d.itens.filter((x) => x.id !== id); }); }
  function dupItem(item: SegurancaItem) {
    mut((d) => { const max = Math.max(0, ...d.itens.filter((i) => i.blocoId === item.blocoId).map((i) => i.ordem)); d.itens.push({ ...clone(item), id: uid(), ordem: max + 1 }); });
  }
  function moveItem(id: string, dir: -1 | 1) {
    mut((d) => {
      const list = d.itens.filter((i) => i.blocoId === d.itens.find((x) => x.id === id)?.blocoId).sort((a, b) => a.ordem - b.ordem);
      const idx = list.findIndex((i) => i.id === id); const j = idx + dir;
      if (j < 0 || j >= list.length) return;
      const a = list[idx], b = list[j]; const t = a.ordem; a.ordem = b.ordem; b.ordem = t;
    });
  }

  // ── Blocos ──
  function addBloco() { mut((d) => { const max = Math.max(0, ...d.blocos.map((b) => b.ordem)); d.blocos.push({ id: uid(), nome: "Novo bloco", ordem: max + 1 }); }); }
  function updBloco(id: string, nome: string) { mut((d) => { const b = d.blocos.find((x) => x.id === id); if (b) b.nome = nome; }); }
  function delBloco(id: string) {
    const n = m.itens.filter((i) => i.blocoId === id).length;
    if (n > 0 && !confirm(`Este bloco tem ${n} item(ns). Excluir bloco e os itens?`)) return;
    mut((d) => { d.blocos = d.blocos.filter((x) => x.id !== id); d.itens = d.itens.filter((i) => i.blocoId !== id); });
  }

  // ── Faixas ──
  function updFaixa(idx: number, patch: Partial<SegurancaFaixa>) { mut((d) => { d.faixas[idx] = { ...d.faixas[idx], ...patch }; }); }

  async function salvar() {
    if (m.itens.some((i) => !i.texto.trim())) { setErro("Há item sem texto. Preencha ou remova."); return; }
    setSalvando(true); setErro("");
    try { await salvarModelo(m); setDirty(false); onClose(); }
    catch (e) { setErro("Falha ao salvar: " + (e instanceof Error ? e.message : "?")); }
    finally { setSalvando(false); }
  }

  const inp = "w-full text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-gray-900 dark:text-gray-100";

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <button onClick={onClose} className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 text-sm inline-flex items-center gap-1">
          <span className="text-base leading-none">←</span> Voltar
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">Editar checklist</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">Um checklist só. Cada item é de uma área — a mesma pergunta em 2 áreas = duplicar.</p>
        </div>
      </div>

      {erro && <div className="text-sm rounded-lg px-3 py-2 bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400">{erro}</div>}

      {/* Nome do modelo */}
      <div>
        <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Nome</label>
        <input className={inp + " mt-1"} value={m.nome} onChange={(e) => { setM({ ...m, nome: e.target.value }); setDirty(true); }} />
      </div>

      {/* Blocos + itens */}
      {blocos.map((b) => (
        <section key={b.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
          <div className="flex items-center gap-2 mb-2">
            <input className={inp + " font-semibold"} value={b.nome} onChange={(e) => updBloco(b.id, e.target.value)} />
            <button onClick={() => delBloco(b.id)} className="shrink-0 text-gray-300 hover:text-rose-500 text-sm px-1" title="Excluir bloco">🗑</button>
          </div>
          <div className="space-y-2">
            {itensDoBloco(b.id).map((item) => (
              <div key={item.id} className="rounded-lg border border-gray-200 dark:border-gray-800 p-2.5 bg-gray-50/60 dark:bg-gray-800/30">
                <textarea rows={2} className={inp} placeholder="Texto da pergunta…" value={item.texto} onChange={(e) => updItem(item.id, { texto: e.target.value })} />
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <select className="text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-gray-900 dark:text-gray-100"
                    value={item.area || ""} onChange={(e) => updItem(item.id, { area: (e.target.value || undefined) as Area | undefined })}>
                    <option value="">— área —</option>
                    {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <label className="text-xs text-gray-600 dark:text-gray-300 inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={item.pontua} onChange={(e) => updItem(item.id, { pontua: e.target.checked })} /> conta na nota
                  </label>
                  <div className="flex-1" />
                  <button onClick={() => moveItem(item.id, -1)} className="text-gray-400 hover:text-gray-700 text-xs px-1" title="Subir">↑</button>
                  <button onClick={() => moveItem(item.id, 1)} className="text-gray-400 hover:text-gray-700 text-xs px-1" title="Descer">↓</button>
                  <button onClick={() => dupItem(item)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline px-1" title="Duplicar (pra outra área)">⧉ duplicar</button>
                  <button onClick={() => delItem(item.id)} className="text-gray-300 hover:text-rose-500 text-sm px-1" title="Excluir item">🗑</button>
                </div>
              </div>
            ))}
            <button onClick={() => addItem(b.id)} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">+ item</button>
          </div>
        </section>
      ))}
      <button onClick={addBloco} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">+ bloco</button>

      {/* Faixas de classificação */}
      <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">Faixas de classificação</div>
        <div className="space-y-2">
          {m.faixas.map((f, idx) => (
            <div key={idx} className="flex items-center gap-2 text-sm">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: f.cor }} />
              <input className={inp} value={f.label} onChange={(e) => updFaixa(idx, { label: e.target.value })} />
              <input type="number" className="w-16 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-gray-900 dark:text-gray-100 tabular-nums" value={f.min} onChange={(e) => updFaixa(idx, { min: Number(e.target.value) })} />
              <span className="text-gray-400 text-xs">a</span>
              <input type="number" className="w-16 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-gray-900 dark:text-gray-100 tabular-nums" value={f.max} onChange={(e) => updFaixa(idx, { max: Number(e.target.value) })} />
              <span className="text-gray-400 text-xs">%</span>
            </div>
          ))}
        </div>
      </section>

      {/* Barra de salvar */}
      <div className="sticky bottom-3 z-10 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur shadow-lg px-4 py-2.5 flex items-center gap-3">
        <span className="text-xs text-gray-500 dark:text-gray-400 flex-1">{m.itens.length} itens · {blocos.length} blocos{dirty ? " · alterações não salvas" : ""}</span>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={() => void salvar()} disabled={salvando || !dirty}>{salvando ? "Salvando…" : "Salvar"}</Button>
      </div>
    </div>
  );
}
