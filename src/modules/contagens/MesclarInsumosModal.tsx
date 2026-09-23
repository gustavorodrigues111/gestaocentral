// Mescla insumos duplicados num só: junta aliases + fornecedores, aponta as
// contagens antigas pro insumo escolhido e apaga os demais.
import { useMemo, useState } from "react";
import { collection, deleteDoc, deleteField, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { Layers, Check, Sparkles, Loader2 } from "lucide-react";
import { db, auth } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Insumo, InsumoFornecedor } from "../../core/types";
import { normalizar } from "./sugestoesRecebimento";

type GrupoDup = { ids: string[]; manter?: string; motivo?: string };

export function MesclarInsumosModal({ insumos, onClose }: { insumos: Insumo[]; onClose: () => void }) {
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [principalId, setPrincipalId] = useState<string>("");
  const [salvando, setSalvando] = useState(false);
  const [err, setErr] = useState("");
  // Resolução de conflito: nome/preço/fornecedor que ficam (default = principal).
  const [nomeFinal, setNomeFinal] = useState<string>("");
  const [precoFinal, setPrecoFinal] = useState<number | null | undefined>(undefined);
  const [fornFinal, setFornFinal] = useState<string>("");
  const prefNomeDe = (i: Insumo) => i.fornecedores?.find(f => f.primario)?.nome || (i.fornecedorPreferredId ? i.fornecedores?.find(f => f.fornecedorId === i.fornecedorPreferredId)?.nome : undefined) || i.fornecedores?.[0]?.nome || "";
  // Sugestão de duplicados por IA.
  const [sugerindo, setSugerindo] = useState(false);
  const [sugestoes, setSugestoes] = useState<GrupoDup[] | null>(null);
  const byId = useMemo(() => new Map(insumos.map(i => [i.id, i])), [insumos]);

  async function sugerirIA() {
    setSugerindo(true); setErr("");
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const r = await fetch("/api/insumos-duplicados-ia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken, insumos: insumos.map(i => ({ id: i.id, nome: i.nome, categoria: i.categoria })) }) });
      const j = await r.json().catch(() => ({})) as { grupos?: GrupoDup[]; error?: string };
      if (!r.ok) { setErr(j.error || "Falha na IA."); return; }
      // Só grupos com 2+ ids que ainda existem.
      const gs = (j.grupos || []).map(g => ({ ...g, ids: (g.ids || []).filter(id => byId.has(id)) })).filter(g => g.ids.length >= 2);
      setSugestoes(gs);
    } catch (e) { setErr(e instanceof Error ? e.message : "Erro na IA"); }
    finally { setSugerindo(false); }
  }
  function usarSugestao(g: GrupoDup) {
    setSel(new Set(g.ids));
    setPrincipalId(g.manter && g.ids.includes(g.manter) ? g.manter : g.ids[0]);
    setSugestoes(s => (s || []).filter(x => x !== g));
  }

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return insumos.filter(i => !b || i.nome.toLowerCase().includes(b) || (i.categoria || "").toLowerCase().includes(b))
      .sort((a, b2) => a.nome.localeCompare(b2.nome));
  }, [insumos, busca]);

  function toggle(id: string) {
    setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); if (!principalId && n.size) setPrincipalId([...n][0]); if (principalId && !n.has(principalId)) setPrincipalId([...n][0] || ""); return n; });
  }

  async function mesclar() {
    const ids = [...sel];
    if (ids.length < 2) { setErr("Selecione ao menos 2 insumos."); return; }
    const principal = insumos.find(i => i.id === (principalId || ids[0]));
    if (!principal) { setErr("Escolha o insumo que fica."); return; }
    const outros = insumos.filter(i => ids.includes(i.id) && i.id !== principal.id);
    if (!confirm(`Mesclar ${ids.length} insumos em "${principal.nome}"? Os outros ${outros.length} serão apagados e as contagens deles apontam pro que fica.`)) return;
    setSalvando(true); setErr("");
    try {
      // 1) Une aliases + fornecedores no principal.
      const aliases = new Set<string>([...(principal.aliases || []), normalizar(principal.nome)]);
      const fornMap = new Map<string, InsumoFornecedor>();
      for (const f of (principal.fornecedores || [])) fornMap.set(normalizar(f.nome), { ...f, primario: false });
      for (const o of outros) {
        aliases.add(normalizar(o.nome));
        for (const a of (o.aliases || [])) aliases.add(a);
        for (const f of (o.fornecedores || [])) if (!fornMap.has(normalizar(f.nome))) fornMap.set(normalizar(f.nome), { ...f, primario: false });
      }
      // Escolhas de conflito (default = principal).
      const nomeF = nomeFinal || principal.nome;
      const precoF = precoFinal !== undefined ? precoFinal : (principal.precoEstimado ?? null);
      const fornF = fornFinal || prefNomeDe(principal);
      let fornPrefId = principal.fornecedorPreferredId ?? null;
      if (fornF) { const k = normalizar(fornF); const f = fornMap.get(k); if (f) { f.primario = true; fornMap.set(k, f); fornPrefId = f.fornecedorId ?? fornPrefId; } }
      const patch: Record<string, unknown> = { nome: nomeF, aliases: [...aliases], fornecedores: [...fornMap.values()], fornecedorPreferredId: fornPrefId, precoEstimado: precoF == null ? deleteField() : precoF, atualizadoEm: new Date().toISOString() };
      await updateDoc(doc(db, "insumos", principal.id), sanitizeForFirestore(patch));
      // 2) Aponta contagens dos outros pro principal e apaga os outros.
      for (const o of outros) {
        const snap = await getDocs(query(collection(db, "contagens"), where("insumoId", "==", o.id)));
        for (const d of snap.docs) await updateDoc(d.ref, { insumoId: principal.id });
        await deleteDoc(doc(db, "insumos", o.id));
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao mesclar");
      setSalvando(false);
    }
  }

  return (
    <Modal title="Mesclar insumos duplicados" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">Marque os insumos que são o mesmo produto e escolha qual fica. Os outros são apagados e o histórico de contagens é preservado no que fica.</p>

        <button type="button" onClick={() => void sugerirIA()} disabled={sugerindo}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 text-white py-2 text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">
          {sugerindo ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {sugerindo ? "Analisando…" : "Sugerir duplicados com IA"}
        </button>
        {sugestoes && sugestoes.length === 0 && <div className="text-[12px] text-emerald-600 dark:text-emerald-400">✓ A IA não encontrou duplicados claros.</div>}
        {sugestoes && sugestoes.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">Possíveis duplicados ({sugestoes.length})</div>
            {sugestoes.map((g, i) => (
              <div key={i} className="rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-900/10 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-[13px]">
                    <div className="text-gray-900 dark:text-gray-100">{g.ids.map(id => byId.get(id)?.nome).filter(Boolean).join("  ≈  ")}</div>
                    {g.motivo && <div className="text-[11px] text-gray-500 mt-0.5">{g.motivo}{g.manter && byId.get(g.manter) ? ` · manter "${byId.get(g.manter)!.nome}"` : ""}</div>}
                  </div>
                  <button type="button" onClick={() => usarSugestao(g)} className="shrink-0 text-[11px] font-semibold px-2 py-1 rounded-md bg-violet-600 text-white hover:bg-violet-700">Usar</button>
                </div>
              </div>
            ))}
            <p className="text-[10px] text-gray-400">"Usar" pré-seleciona o grupo abaixo pra você conferir e mesclar. Nada é apagado até você clicar em Mesclar.</p>
          </div>
        )}

        <Input placeholder="🔍 Buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <div className="max-h-72 overflow-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {lista.map(i => {
            const on = sel.has(i.id);
            const ehPrincipal = principalId === i.id;
            return (
              <div key={i.id} className={`flex items-center gap-2 px-2.5 py-2 text-sm ${on ? "bg-indigo-50/50 dark:bg-indigo-900/10" : ""}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(i.id)} />
                <button type="button" onClick={() => toggle(i.id)} className="flex-1 text-left min-w-0">
                  <span className="text-gray-900 dark:text-gray-100">{i.nome}</span>
                  {i.categoria && <span className="text-[11px] text-gray-400 ml-1.5">{i.categoria}</span>}
                </button>
                {on && (
                  <button type="button" onClick={() => setPrincipalId(i.id)} title="Este fica" className={`text-[10px] px-1.5 py-0.5 rounded-full inline-flex items-center gap-1 ${ehPrincipal ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-semibold" : "border border-gray-200 dark:border-gray-700 text-gray-500"}`}>
                    {ehPrincipal ? <><Check size={10} /> fica</> : "fica?"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {/* Resolução de conflito — o que fica ao mesclar */}
        {sel.size >= 2 && (() => {
          const selecionados = insumos.filter(i => sel.has(i.id));
          const principal = insumos.find(i => i.id === (principalId || [...sel][0]));
          const nomes = [...new Set(selecionados.map(i => i.nome).filter(Boolean))];
          const precos = [...new Set(selecionados.map(i => i.precoEstimado).filter((p): p is number => p != null))];
          const forns = [...new Set(selecionados.flatMap(i => (i.fornecedores || []).map(f => f.nome)).filter(Boolean))];
          const nomeAtual = nomeFinal || principal?.nome || "";
          const precoAtual = precoFinal !== undefined ? precoFinal : (principal?.precoEstimado ?? null);
          const fornAtual = fornFinal || (principal ? prefNomeDe(principal) : "");
          return (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2.5 space-y-2 bg-gray-50/60 dark:bg-gray-800/30">
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">O que fica</div>
              {nomes.length > 1 && (
                <div>
                  <div className="text-[10px] uppercase text-gray-400 mb-1">Nome</div>
                  <div className="flex flex-wrap gap-1.5">{nomes.map(n => <button key={n} type="button" onClick={() => setNomeFinal(n)} className={`px-2 py-1 rounded-full text-[12px] border ${nomeAtual === n ? "bg-emerald-600 border-emerald-600 text-white" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>{n}</button>)}</div>
                </div>
              )}
              {precos.length > 1 && (
                <div>
                  <div className="text-[10px] uppercase text-gray-400 mb-1">Preço /un</div>
                  <div className="flex flex-wrap gap-1.5">{precos.map(p => <button key={p} type="button" onClick={() => setPrecoFinal(p)} className={`px-2 py-1 rounded-full text-[12px] border ${precoAtual === p ? "bg-emerald-600 border-emerald-600 text-white" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>R$ {p.toFixed(2)}</button>)}</div>
                </div>
              )}
              {forns.length > 1 && (
                <div>
                  <div className="text-[10px] uppercase text-gray-400 mb-1">Fornecedor preferencial</div>
                  <div className="flex flex-wrap gap-1.5">{forns.map(n => <button key={n} type="button" onClick={() => setFornFinal(n)} className={`px-2 py-1 rounded-full text-[12px] border ${fornAtual === n ? "bg-emerald-600 border-emerald-600 text-white" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>{n}</button>)}</div>
                </div>
              )}
              {nomes.length <= 1 && precos.length <= 1 && forns.length <= 1 && <div className="text-[11px] text-gray-400">Sem conflitos — nome, preço e fornecedor iguais.</div>}
            </div>
          );
        })()}
        {err && <div className="text-sm text-rose-600">{err}</div>}
        <div className="flex justify-between items-center pt-3 border-t border-gray-200 dark:border-gray-800">
          <span className="text-xs text-gray-400">{sel.size} selecionado(s)</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={mesclar} disabled={salvando || sel.size < 2}><span className="inline-flex items-center gap-1.5"><Layers size={14} /> {salvando ? "Mesclando…" : "Mesclar"}</span></Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
