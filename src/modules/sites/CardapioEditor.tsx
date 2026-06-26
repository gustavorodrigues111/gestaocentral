// Editor estruturado do cardápio (Fase 1). Seções → pratos (título + subtítulo
// + preço). Salva automático (debounce) em /cardapioEstruturado/{rid}. O site
// renderiza ao vivo quando o modo do cardápio é "editor".
import { useEffect, useRef, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import type { CardapioEstruturado, SecaoCardapio, PratoCardapio } from "../../core/types";

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const SECOES_SOROROCA = ["Frios", "Quentes", "Brasa", "Acompanhamentos", "Sobremesas"];

export function CardapioEditor({ rid, podeEditar }: { rid: string; podeEditar: boolean }) {
  const { pessoa: me } = useAuth();
  const [secoes, setSecoes] = useState<SecaoCardapio[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [estado, setEstado] = useState<"" | "salvando" | "salvo">("");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancel = false;
    void getDoc(doc(db, "cardapioEstruturado", rid)).then((snap) => {
      if (cancel) return;
      const data = snap.exists() ? (snap.data() as CardapioEstruturado) : null;
      setSecoes(data?.secoes || []);
      setCarregando(false);
    });
    return () => { cancel = true; };
  }, [rid]);

  function commit(next: SecaoCardapio[]) {
    setSecoes(next);
    if (!podeEditar) return;
    setEstado("salvando");
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const payload: CardapioEstruturado = {
          id: rid, restaurantId: rid, secoes: next,
          atualizadoEm: new Date().toISOString(), atualizadoPor: me?.id,
        };
        await setDoc(doc(db, "cardapioEstruturado", rid), sanitizeForFirestore(payload));
        setEstado("salvo");
        setTimeout(() => setEstado(""), 1800);
      } catch { setEstado(""); }
    }, 700);
  }

  // ── mutators ──────────────────────────────────────────────────────────────
  const setSec = (i: number, patch: Partial<SecaoCardapio>) => commit(secoes.map((s, j) => j === i ? { ...s, ...patch } : s));
  const addSecao = (nome = "") => commit([...secoes, { id: uid(), nome, pratos: [] }]);
  const removeSecao = (i: number) => commit(secoes.filter((_, j) => j !== i));
  const moveSecao = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= secoes.length) return;
    const n = [...secoes]; [n[i], n[j]] = [n[j]!, n[i]!]; commit(n);
  };
  const setPrato = (si: number, pi: number, patch: Partial<PratoCardapio>) =>
    setSec(si, { pratos: secoes[si]!.pratos.map((p, j) => j === pi ? { ...p, ...patch } : p) });
  const addPrato = (si: number) => setSec(si, { pratos: [...secoes[si]!.pratos, { id: uid(), titulo: "" }] });
  const removePrato = (si: number, pi: number) => setSec(si, { pratos: secoes[si]!.pratos.filter((_, j) => j !== pi) });
  const movePrato = (si: number, pi: number, dir: -1 | 1) => {
    const pratos = [...secoes[si]!.pratos]; const j = pi + dir;
    if (j < 0 || j >= pratos.length) return;
    [pratos[pi], pratos[j]] = [pratos[j]!, pratos[pi]!]; setSec(si, { pratos });
  };

  if (carregando) return <div className="text-sm text-gray-500">Carregando cardápio…</div>;

  const inp = "px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-60";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] text-gray-500 dark:text-gray-400">Monte o cardápio por seções. Cada prato tem <strong>título</strong> (nome), <strong>subtítulo</strong> (descrição) e <strong>preço</strong>. Salva sozinho.</p>
        <span className="text-[12px] text-emerald-600 dark:text-emerald-400 min-w-16 text-right">
          {estado === "salvando" ? "salvando…" : estado === "salvo" ? "✓ salvo" : ""}
        </span>
      </div>

      {secoes.length === 0 && (
        <div className="text-center py-8 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl space-y-3">
          <p className="text-sm text-gray-400">Nenhuma seção ainda.</p>
          {podeEditar && (
            <div className="flex flex-wrap gap-2 justify-center">
              <button type="button" onClick={() => addSecao()} className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white">+ Adicionar seção</button>
              <button type="button" onClick={() => commit(SECOES_SOROROCA.map((nome) => ({ id: uid(), nome, pratos: [] })))} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">
                Criar seções do Sororoca (Frios, Quentes, Brasa…)
              </button>
            </div>
          )}
        </div>
      )}

      {secoes.map((sec, si) => (
        <div key={sec.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input value={sec.nome} disabled={!podeEditar} onChange={(e) => setSec(si, { nome: e.target.value })} placeholder="Nome da seção (ex: Frios)" className={`${inp} flex-1 font-bold`} />
            {podeEditar && (
              <div className="flex items-center gap-0.5 shrink-0 text-gray-400">
                <button type="button" title="Subir" onClick={() => moveSecao(si, -1)} className="px-1.5 hover:text-gray-700">↑</button>
                <button type="button" title="Descer" onClick={() => moveSecao(si, 1)} className="px-1.5 hover:text-gray-700">↓</button>
                <button type="button" title="Remover seção" onClick={() => { if (confirm(`Remover a seção "${sec.nome}" e seus pratos?`)) removeSecao(si); }} className="px-1.5 hover:text-rose-600">🗑</button>
              </div>
            )}
          </div>
          <input value={sec.obs || ""} disabled={!podeEditar} onChange={(e) => setSec(si, { obs: e.target.value || undefined })} placeholder="Observação da seção (opcional) — ex: consulte as opções do dia na lousa" className={`${inp} w-full text-[12px] text-gray-500`} />

          <div className="space-y-1.5">
            {sec.pratos.map((p, pi) => (
              <div key={p.id} className="rounded-lg border border-gray-100 dark:border-gray-800 p-2 space-y-1">
                <div className="flex items-center gap-2">
                  <input value={p.titulo} disabled={!podeEditar} onChange={(e) => setPrato(si, pi, { titulo: e.target.value })} placeholder="Título do prato" className={`${inp} flex-1 font-semibold`} />
                  <input value={p.preco || ""} disabled={!podeEditar} onChange={(e) => setPrato(si, pi, { preco: e.target.value || undefined })} placeholder="Preço" className={`${inp} w-24 text-right`} />
                  {podeEditar && (
                    <div className="flex items-center gap-0.5 shrink-0 text-gray-400">
                      <button type="button" title="Subir" onClick={() => movePrato(si, pi, -1)} className="px-1 hover:text-gray-700">↑</button>
                      <button type="button" title="Descer" onClick={() => movePrato(si, pi, 1)} className="px-1 hover:text-gray-700">↓</button>
                      <button type="button" title="Remover" onClick={() => removePrato(si, pi)} className="px-1 hover:text-rose-600">✕</button>
                    </div>
                  )}
                </div>
                <input value={p.subtitulo || ""} disabled={!podeEditar} onChange={(e) => setPrato(si, pi, { subtitulo: e.target.value || undefined })} placeholder="Subtítulo / descrição (opcional)" className={`${inp} w-full text-[12px] text-gray-500`} />
              </div>
            ))}
          </div>

          {podeEditar && (
            <button type="button" onClick={() => addPrato(si)} className="text-[12px] text-indigo-600 hover:underline">+ adicionar prato</button>
          )}
        </div>
      ))}

      {podeEditar && secoes.length > 0 && (
        <button type="button" onClick={() => addSecao()} className="text-sm px-3 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300">+ Adicionar seção</button>
      )}
    </div>
  );
}
