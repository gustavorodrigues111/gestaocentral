// Editor do checklist-modelo (cadastro/edição). UMA pergunta pode valer pra
// VÁRIAS áreas (marque as áreas no item) — no preenchimento recebe uma resposta
// por área. Também define o LÍDER responsável por cada área (quem recebe as
// ações), blocos e faixas. Edição em estado local; "Salvar" persiste.
// Requer permissão `configurar`.
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import type { SegurancaFaixa, SegurancaItem, SegurancaModelo, Pessoa } from "../../core/types";
import { SEG_AREAS_PADRAO, segAreaCor, segItemAreas } from "../../core/types";
import { salvarModelo } from "./repository";

const uid = () => Math.random().toString(36).slice(2, 11);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function ModeloEditor({ modelo, onClose }: { modelo: SegurancaModelo; onClose: () => void }) {
  const [m, setM] = useState<SegurancaModelo>(() => {
    const c = clone(modelo);
    // Retrocompat: templates antigos sem `areas` → deriva dos itens ou padrão.
    if (!Array.isArray(c.areas) || c.areas.length === 0) {
      const dosItens = Array.from(new Set((c.itens || []).flatMap(segItemAreas)));
      c.areas = dosItens.length ? dosItens : [...SEG_AREAS_PADRAO];
    }
    // Retrocompat: item com `area` única → migra pra `areas: [area]`.
    (c.itens || []).forEach((i) => { if (!Array.isArray(i.areas)) i.areas = i.area ? [i.area] : []; });
    // Retrocompat: líder único (objeto) → lista de líderes.
    const ra = (c.responsaveisArea || {}) as Record<string, unknown>;
    const normalizado: Record<string, { id: string; nome: string }[]> = {};
    for (const [area, v] of Object.entries(ra)) {
      if (Array.isArray(v)) normalizado[area] = v as { id: string; nome: string }[];
      else if (v && typeof v === "object" && (v as { id?: string }).id) normalizado[area] = [v as { id: string; nome: string }];
    }
    c.responsaveisArea = normalizado;
    return c;
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [dirty, setDirty] = useState(false);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);

  useEffect(() => {
    const rid = modelo.restaurantId;
    if (!rid) return;
    return onSnapshot(query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid)),
      (snap) => setPessoas(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Pessoa).filter((p) => p.ativa !== false)),
      () => setPessoas([]));
  }, [modelo.restaurantId]);
  const pessoasOrd = useMemo(() => [...pessoas].sort((a, b) => a.nome.localeCompare(b.nome)), [pessoas]);

  const blocos = m.blocos.slice().sort((a, b) => a.ordem - b.ordem);
  function mut(fn: (d: SegurancaModelo) => void) { setM((prev) => { const d = clone(prev); fn(d); return d; }); setDirty(true); }

  // ── Itens ──
  const itensDoBloco = (bid: string) => m.itens.filter((i) => i.blocoId === bid).sort((a, b) => a.ordem - b.ordem);
  function addItem(bid: string) {
    mut((d) => { const max = Math.max(0, ...d.itens.filter((i) => i.blocoId === bid).map((i) => i.ordem)); d.itens.push({ id: uid(), texto: "", blocoId: bid, areas: d.areas.length ? [d.areas[0]] : [], ordem: max + 1, pontua: true }); });
  }

  // ── Áreas (cadastráveis) ──
  function addArea() {
    const nome = prompt("Nome da nova área:");
    if (!nome || !nome.trim()) return;
    const nn = nome.trim();
    mut((d) => { if (!d.areas.includes(nn)) d.areas.push(nn); });
  }
  function renomearArea(idx: number) {
    const antigo = m.areas[idx];
    const novo = prompt("Renomear área:", antigo);
    if (novo === null) return;
    const nn = novo.trim(); if (!nn) return;
    mut((d) => {
      if (d.areas.includes(nn) && nn !== antigo) { return; }
      d.areas[idx] = nn;
      d.itens.forEach((i) => { i.areas = (i.areas || []).map((a) => (a === antigo ? nn : a)); }); // reatribui itens
      if (d.responsaveisArea?.[antigo]) { d.responsaveisArea![nn] = d.responsaveisArea![antigo]; delete d.responsaveisArea![antigo]; }
    });
  }
  function removerArea(idx: number) {
    const nome = m.areas[idx];
    const usados = m.itens.filter((i) => segItemAreas(i).includes(nome)).length;
    if (usados > 0 && !confirm(`${usados} item(ns) usam a área "${nome}". Remover mesmo? A área sai desses itens.`)) return;
    mut((d) => {
      d.areas.splice(idx, 1);
      d.itens.forEach((i) => { i.areas = (i.areas || []).filter((a) => a !== nome); });
      if (d.responsaveisArea) delete d.responsaveisArea[nome];
    });
  }
  function addLiderArea(area: string, pid: string) {
    if (!pid) return;
    mut((d) => {
      if (!d.responsaveisArea) d.responsaveisArea = {};
      const atuais = d.responsaveisArea[area] || [];
      if (atuais.some((l) => l.id === pid)) return;
      const nome = pessoasOrd.find((p) => p.id === pid)?.nome || "";
      d.responsaveisArea[area] = [...atuais, { id: pid, nome }];
    });
  }
  function removeLiderArea(area: string, pid: string) {
    mut((d) => {
      if (!d.responsaveisArea?.[area]) return;
      d.responsaveisArea[area] = d.responsaveisArea[area].filter((l) => l.id !== pid);
      if (d.responsaveisArea[area].length === 0) delete d.responsaveisArea[area];
    });
  }
  function toggleItemArea(id: string, area: string) {
    mut((d) => {
      const i = d.itens.find((x) => x.id === id); if (!i) return;
      const cur = i.areas || [];
      i.areas = cur.includes(area) ? cur.filter((a) => a !== area) : [...cur, area];
    });
  }
  function updItem(id: string, patch: Partial<SegurancaItem>) { mut((d) => { const i = d.itens.find((x) => x.id === id); if (i) Object.assign(i, patch); }); }
  function delItem(id: string) { mut((d) => { d.itens = d.itens.filter((x) => x.id !== id); }); }
  function dupItem(item: SegurancaItem) {
    mut((d) => {
      const nova: SegurancaItem = { ...clone(item), id: uid() };
      const doBloco = d.itens.filter((i) => i.blocoId === item.blocoId).sort((a, b) => a.ordem - b.ordem);
      const idx = doBloco.findIndex((i) => i.id === item.id);
      doBloco.splice(idx + 1, 0, nova);         // insere logo abaixo do original
      doBloco.forEach((i, k) => { i.ordem = k + 1; }); // renumera o bloco
      d.itens.push(nova);
    });
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
          <p className="text-xs text-gray-500 dark:text-gray-400">Uma pergunta pode valer pra várias áreas — marque as áreas no item. Cada área responde separado.</p>
        </div>
      </div>

      {erro && <div className="text-sm rounded-lg px-3 py-2 bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400">{erro}</div>}

      {/* Nome do modelo */}
      <div>
        <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Nome</label>
        <input className={inp + " mt-1"} value={m.nome} onChange={(e) => { setM({ ...m, nome: e.target.value }); setDirty(true); }} />
      </div>

      {/* Áreas cadastráveis */}
      <div>
        <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 block mb-1.5">Áreas</label>
        <div className="flex flex-wrap gap-2 items-center">
          {m.areas.map((a, idx) => {
            const c = segAreaCor(a);
            return (
              <span key={idx} className={`inline-flex items-center gap-1.5 text-[13px] font-medium pl-2.5 pr-1.5 py-1 rounded-full ${c.bg} ${c.fg}`}>
                <span className="w-2 h-2 rounded-full" style={{ background: c.dot }} />
                <button type="button" onClick={() => renomearArea(idx)} title="Renomear">{a}</button>
                <button type="button" onClick={() => removerArea(idx)} title="Remover" className="opacity-60 hover:opacity-100 text-sm leading-none">×</button>
              </span>
            );
          })}
          <button type="button" onClick={addArea} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">+ área</button>
        </div>
      </div>

      {/* Líderes responsáveis por área — recebem as ações das não-conformidades */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
        <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 block mb-2">Líderes de cada área</label>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">Ao virar ação uma não-conformidade, a tarefa vai pra todos os líderes da área (cada um a recebe na Central de Avisos). Pode ter mais de um por área.</p>
        <div className="space-y-3">
          {m.areas.map((a) => {
            const c = segAreaCor(a);
            const lideres = m.responsaveisArea?.[a] || [];
            const disponiveis = pessoasOrd.filter((p) => !lideres.some((l) => l.id === p.id));
            return (
              <div key={a} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
                <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium px-2.5 py-1 rounded-full w-fit shrink-0 sm:mt-0.5 ${c.bg} ${c.fg}`}>
                  <span className="w-2 h-2 rounded-full" style={{ background: c.dot }} />{a}
                </span>
                <div className="flex flex-wrap gap-1.5 items-center flex-1">
                  {lideres.map((l) => (
                    <span key={l.id} className="inline-flex items-center gap-1.5 text-[13px] pl-2.5 pr-1 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">
                      {l.nome || "?"}
                      <button type="button" onClick={() => removeLiderArea(a, l.id)} title="Remover" className="opacity-50 hover:opacity-100 text-sm leading-none">×</button>
                    </span>
                  ))}
                  <select
                    value="" onChange={(e) => { addLiderArea(a, e.target.value); e.target.value = ""; }}
                    className="text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-gray-600 dark:text-gray-300">
                    <option value="">{lideres.length ? "+ líder" : "— escolher líder —"}</option>
                    {disponiveis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
          {m.areas.length === 0 && <p className="text-sm text-gray-400">Cadastre áreas acima primeiro.</p>}
        </div>
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
                {/* Áreas da pergunta (marque uma ou mais) */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {m.areas.map((a) => {
                    const on = (item.areas || []).includes(a);
                    const c = segAreaCor(a);
                    return (
                      <button key={a} type="button" onClick={() => toggleItemArea(item.id, a)}
                        className={`text-[12px] font-medium px-2.5 py-1 rounded-full border transition-colors inline-flex items-center gap-1.5 ${on ? `${c.bg} ${c.fg} border-transparent` : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-400 dark:text-gray-500"}`}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: on ? c.dot : "currentColor" }} />{a}
                      </button>
                    );
                  })}
                  {(item.areas || []).length === 0 && <span className="text-[11px] text-rose-500 self-center">sem área</span>}
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <label className="text-xs text-gray-600 dark:text-gray-300 inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={item.pontua} onChange={(e) => updItem(item.id, { pontua: e.target.checked })} /> conta na nota
                  </label>
                  <div className="flex-1" />
                  <button onClick={() => moveItem(item.id, -1)} className="text-gray-400 hover:text-gray-700 text-xs px-1" title="Subir">↑</button>
                  <button onClick={() => moveItem(item.id, 1)} className="text-gray-400 hover:text-gray-700 text-xs px-1" title="Descer">↓</button>
                  <button onClick={() => dupItem(item)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline px-1" title="Duplicar pergunta">⧉ duplicar</button>
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
