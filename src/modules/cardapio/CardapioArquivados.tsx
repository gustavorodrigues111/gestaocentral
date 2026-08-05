// Aba "Arquivados" do módulo Cardápios — lixeira de pratos removidos.
// Lista o que foi removido (via agente ou manualmente), permite RESTAURAR na
// posição original (reinsere em cardapioEstruturado) e EXCLUIR de vez.
// Também permite REGISTRAR manualmente um prato removido antes da lixeira
// existir (ex.: remoções feitas antes desta funcionalidade).
import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { fmtBRDateTime } from "../../core/utils/date";
import type { CardapioEstruturado, CardapioMenu, PratoCardapio, SecaoCardapio } from "../../core/types";

type ArqPrato = {
  id: string;
  engine?: string;
  cardapio: string;
  secao: string;
  posicao: number;
  nome: string;
  raw: Partial<PratoCardapio> & Record<string, unknown>;
  arquivadoEm: string;
  arquivadoPor?: string;
};

const nrm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export function CardapioArquivados({ rid, podeEditar, meId, cardapios }: {
  rid: string; podeEditar: boolean; meId?: string; cardapios: CardapioMenu[];
}) {
  const [arqs, setArqs] = useState<ArqPrato[] | null>(null);
  const [busy, setBusy] = useState<string>("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const snap = await getDoc(doc(db, "cardapioArquivados", rid)).catch(() => null);
      if (!alive) return;
      const d = snap && snap.exists() ? (snap.data() as { pratos?: ArqPrato[] }) : null;
      setArqs(Array.isArray(d?.pratos) ? (d!.pratos as ArqPrato[]) : []);
    })();
    return () => { alive = false; };
  }, [rid]);

  async function salvarArqs(next: ArqPrato[]) {
    setArqs(next);
    await setDoc(doc(db, "cardapioArquivados", rid), sanitizeForFirestore({ pratos: next, atualizadoEm: new Date().toISOString() }), { merge: true }).catch((e) => {
      alert("Não consegui salvar: " + (e instanceof Error ? e.message : ""));
    });
  }

  async function restaurar(e: ArqPrato) {
    if (!podeEditar) return;
    setBusy(e.id);
    try {
      const ref = doc(db, "cardapioEstruturado", rid);
      const snap = await getDoc(ref);
      const lista = ((snap.exists() ? (snap.data() as CardapioEstruturado).cardapios : []) || []) as CardapioMenu[];
      const c = lista.find((x) => nrm(x.nome) === nrm(e.cardapio)) || lista[0];
      if (!c) { alert("Não há cardápio pra restaurar."); return; }
      let s = (c.secoes || []).find((x) => nrm(x.nome) === nrm(e.secao));
      if (!s) { s = { id: uid(), nome: e.secao || "OUTROS", pratos: [] } as SecaoCardapio; c.secoes = [...(c.secoes || []), s]; }
      const pratos = s.pratos || [];
      const idx = Math.max(0, Math.min(e.posicao ?? pratos.length, pratos.length));
      const novo = { ...(e.raw || {}), id: (e.raw?.id as string) || uid(), titulo: e.raw?.titulo || e.nome, tipo: (e.raw?.tipo as PratoCardapio["tipo"]) || "item" } as PratoCardapio;
      pratos.splice(idx, 0, novo);
      s.pratos = pratos;
      await setDoc(ref, sanitizeForFirestore({ id: rid, restaurantId: rid, cardapios: lista, atualizadoEm: new Date().toISOString(), atualizadoPor: meId }), { merge: true });
      await salvarArqs((arqs || []).filter((a) => a.id !== e.id));
    } finally { setBusy(""); }
  }

  async function excluir(e: ArqPrato) {
    if (!podeEditar) return;
    if (!confirm(`Excluir "${e.nome}" da lixeira de vez? Não dá pra restaurar depois.`)) return;
    await salvarArqs((arqs || []).filter((a) => a.id !== e.id));
  }

  // ── Registrar manualmente (remoções feitas antes da lixeira existir) ──
  const nomesCardapio = cardapios.map((c) => c.nome).filter(Boolean);
  const [addOpen, setAddOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [cardapio, setCardapio] = useState(nomesCardapio[0] || "Comidas");
  const [secao, setSecao] = useState("");
  const [preco, setPreco] = useState("");
  const [subtitulo, setSubtitulo] = useState("");

  async function adicionarManual() {
    if (!nome.trim() || !secao.trim()) { alert("Preencha ao menos o nome do prato e a seção."); return; }
    const entry: ArqPrato = {
      id: `arq_${uid()}`, engine: "site",
      cardapio: cardapio.trim() || "Comidas", secao: secao.trim(), posicao: 0, nome: nome.trim(),
      raw: { id: `prato_${uid()}`, titulo: nome.trim(), subtitulo: subtitulo.trim() || undefined, preco: preco.trim() || undefined, tipo: "item" },
      arquivadoEm: new Date().toISOString(), arquivadoPor: meId,
    };
    await salvarArqs([entry, ...(arqs || [])]);
    setNome(""); setPreco(""); setSubtitulo("");
    setAddOpen(false);
  }

  if (arqs === null) return <div className="text-gray-400 py-10 text-center text-sm">Carregando…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-bold text-gray-900 dark:text-gray-100">🗑️ Pratos arquivados</h3>
          <p className="text-[12px] text-gray-500 dark:text-gray-400 max-w-xl">Pratos removidos do cardápio ficam aqui e podem voltar na posição original, com preço e descrição que tinham. Remoções feitas pelo agente entram sozinhas.</p>
        </div>
        {podeEditar && (
          <button type="button" onClick={() => setAddOpen((v) => !v)} className="text-sm font-medium px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 shrink-0">
            {addOpen ? "Cancelar" : "+ Registrar prato removido"}
          </button>
        )}
      </div>

      {addOpen && podeEditar && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
          <p className="text-[12px] text-gray-500 dark:text-gray-400">Pra registrar um prato que foi removido antes desta funcionalidade — assim ele fica recuperável.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="text-[12px] text-gray-600 dark:text-gray-300">Prato
              <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: ostra no vapor" className="mt-1 w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
            </label>
            <label className="text-[12px] text-gray-600 dark:text-gray-300">Preço
              <input value={preco} onChange={(e) => setPreco(e.target.value)} placeholder="ex.: 44 | 74" className="mt-1 w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
            </label>
            <label className="text-[12px] text-gray-600 dark:text-gray-300">Cardápio
              <input list="arq-cardapios" value={cardapio} onChange={(e) => setCardapio(e.target.value)} className="mt-1 w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
              <datalist id="arq-cardapios">{nomesCardapio.map((n) => <option key={n} value={n} />)}</datalist>
            </label>
            <label className="text-[12px] text-gray-600 dark:text-gray-300">Seção
              <input value={secao} onChange={(e) => setSecao(e.target.value)} placeholder="ex.: Frios" className="mt-1 w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
            </label>
          </div>
          <label className="text-[12px] text-gray-600 dark:text-gray-300 block">Descrição (opcional)
            <input value={subtitulo} onChange={(e) => setSubtitulo(e.target.value)} placeholder="subtítulo do prato" className="mt-1 w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
          </label>
          <div className="flex justify-end">
            <button type="button" onClick={() => void adicionarManual()} className="text-sm font-medium px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">Registrar na lixeira</button>
          </div>
        </div>
      )}

      {arqs.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl">
          <p className="text-sm text-gray-400">Nenhum prato arquivado.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
          {arqs.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/30">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{e.nome}</div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                  {e.cardapio} · {e.secao}{e.raw?.preco ? ` · ${e.raw.preco}` : ""}{e.arquivadoEm ? ` · removido ${fmtBRDateTime(e.arquivadoEm)}` : ""}
                </div>
              </div>
              {podeEditar && (
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button" disabled={!!busy} onClick={() => void restaurar(e)} className="text-[12px] font-medium px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                    {busy === e.id ? "Restaurando…" : "↩ Restaurar"}
                  </button>
                  <button type="button" disabled={!!busy} onClick={() => void excluir(e)} className="text-[12px] text-rose-600 hover:underline disabled:opacity-50">Excluir</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
