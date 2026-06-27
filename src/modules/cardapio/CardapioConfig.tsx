// Configurações do Cardápio (por restaurante): define a fonte de TÍTULOS e a de
// CORPO uma vez, valendo pra todos os cardápios. Salvo no layout COMPARTILHADO
// (cardapioEstruturado.layout). O designer do PDF só carrega essas 2 fontes.
import { useEffect, useState } from "react";
import { doc, getDoc, updateDoc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { FontePicker, AdicionarFonteModal } from "../sites/shared/FontePicker";
import { opcoesFonte, resolverFonte, urlsCss2 } from "../sites/shared/cardapioFontes";
import type { CardapioEstruturado, CardapioLayout } from "../../core/types";

export function CardapioConfig({ rid, podeEditar, atualizadoPor }: { rid: string; podeEditar: boolean; atualizadoPor?: string }) {
  const [lay, setLay] = useState<CardapioLayout>({ fonteTitulos: "dm-serif-display", fonteCorpo: "inter", fontesCustom: [] });
  const [addFonte, setAddFonte] = useState(false);
  const [estado, setEstado] = useState<"" | "salvando" | "salvo">("");

  useEffect(() => {
    void getDoc(doc(db, "cardapioEstruturado", rid)).then((s) => {
      const d = s.exists() ? (s.data() as CardapioEstruturado) : null;
      const l = d?.layout;
      if (l) setLay({ fonteTitulos: l.fonteTitulos || "dm-serif-display", fonteCorpo: l.fonteCorpo || "inter", fontesCustom: l.fontesCustom || [] });
    });
  }, [rid]);

  // Carrega o catálogo (curadas + custom) só enquanto a config está aberta — pros
  // previews dos dropdowns. (O designer do PDF NÃO carrega isso.)
  useEffect(() => {
    const links = urlsCss2(opcoesFonte(lay.fontesCustom || [])).map((href) => {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = href;
      document.head.appendChild(l);
      return l;
    });
    return () => links.forEach((l) => l.remove());
  }, [lay.fontesCustom]);

  async function salvar(patch: Partial<CardapioLayout>) {
    const next = { ...lay, ...patch };
    setLay(next);
    if (!podeEditar) return;
    setEstado("salvando");
    const ref = doc(db, "cardapioEstruturado", rid);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) await updateDoc(ref, sanitizeForFirestore({ "layout.fonteTitulos": next.fonteTitulos, "layout.fonteCorpo": next.fonteCorpo, "layout.fontesCustom": next.fontesCustom || [] }));
      else await setDoc(ref, sanitizeForFirestore({ id: rid, restaurantId: rid, layout: next, atualizadoEm: new Date().toISOString(), atualizadoPor }), { merge: true });
      setEstado("salvo"); setTimeout(() => setEstado(""), 1800);
    } catch { setEstado(""); }
  }

  const fTit = resolverFonte(lay.fonteTitulos, lay.fontesCustom || []);
  const fCorpo = resolverFonte(lay.fonteCorpo, lay.fontesCustom || []);

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Fontes do cardápio</h3>
        <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">Defina uma vez. Vale para todos os cardápios deste restaurante — só muda num cardápio específico se você marcar "formatar diferente" no preview dele.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <FontePicker label="Fonte dos títulos / seções" value={lay.fonteTitulos || ""} custom={lay.fontesCustom || []} onChange={(id) => void salvar({ fonteTitulos: id })} onAdicionar={() => setAddFonte(true)} />
        <FontePicker label="Fonte do corpo (pratos / descrições)" value={lay.fonteCorpo || ""} custom={lay.fontesCustom || []} onChange={(id) => void salvar({ fonteCorpo: id })} onAdicionar={() => setAddFonte(true)} />
      </div>

      {/* Amostra com as 2 fontes escolhidas */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-5 bg-white dark:bg-gray-900/40">
        <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">Amostra</div>
        <div style={{ fontFamily: fTit.cssFamily, fontSize: 24, color: "#1d3c4b", fontWeight: 600 }}>Entradas</div>
        <div style={{ fontFamily: fCorpo.cssFamily, fontSize: 15, fontWeight: 600, color: "#222", marginTop: 8 }}>Bolinho de bacalhau</div>
        <div style={{ fontFamily: fCorpo.cssFamily, fontSize: 13, color: "#777", marginTop: 2 }}>Crocante por fora, cremoso por dentro, com aioli de limão-siciliano.</div>
      </div>

      <div className="text-[12px] h-4">
        {estado === "salvando" ? <span className="text-gray-400">salvando…</span> : estado === "salvo" ? <span className="text-emerald-600 dark:text-emerald-400 font-medium">✓ Fontes salvas</span> : null}
      </div>

      {addFonte && <AdicionarFonteModal onClose={() => setAddFonte(false)} onAdd={(f) => { void salvar({ fontesCustom: [...new Set([...(lay.fontesCustom || []), f])] }); setAddFonte(false); }} />}
    </div>
  );
}
