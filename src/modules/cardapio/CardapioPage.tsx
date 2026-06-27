// Módulo independente "Cardápio" (Configurações → Cardápio). Vários cardápios
// por restaurante (Comidas, Bebidas, Vinhos) em abas; cada um editado por dentro
// com o mesmo editor/designer. O site puxa daqui. Doc: cardapioEstruturado/{rid}
// = { cardapios: [...], layout (visual compartilhado) }.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canUse } from "../../core/auth/permissions";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { CardapioEditor } from "../sites/CardapioEditor";
import { CardapioConfig } from "./CardapioConfig";
import { carregarFontesCardapio } from "../sites/shared/FontePicker";
import type { CardapioEstruturado, CardapioLayout, CardapioMenu } from "../../core/types";

const CONFIG = "__config__";

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

export function CardapioPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find((r) => r.id === rid) || null;
  const podeVer = canUse(me, rid, "cardapio");
  const { can } = useCanAcao(rid);
  const podeEditar = !!me?.isMaster || can("cardapio", "editar");

  const [cardapios, setCardapios] = useState<CardapioMenu[] | null>(null);
  const [sel, setSel] = useState<string>("");
  const [sharedLayout, setSharedLayout] = useState<CardapioLayout | null>(null);

  async function carregar() {
    const ref = doc(db, "cardapioEstruturado", rid);
    const snap = await getDoc(ref);
    const d = snap.exists() ? (snap.data() as CardapioEstruturado) : null;
    let cards = d?.cardapios || [];
    // Migração: cardápio legado (campo `secoes`) → cardápio "Comidas".
    if (!cards.length && d?.secoes?.length) {
      cards = [{ id: uid(), nome: "Comidas", tituloCapa: d.layout?.tituloCapa || "COMIDAS", secoes: d.secoes, ...(d.traduzidoEm ? { traduzidoEm: d.traduzidoEm } : {}) }];
      if (podeEditar) await setDoc(ref, sanitizeForFirestore({ id: rid, restaurantId: rid, cardapios: cards, atualizadoEm: new Date().toISOString(), atualizadoPor: me?.id }), { merge: true }).catch(() => {});
    }
    setCardapios(cards);
    setSharedLayout(d?.layout || {});
    setSel((s) => (s && (s === CONFIG || cards.some((c) => c.id === s)) ? s : cards[0]?.id || ""));
  }
  useEffect(() => { void carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [rid]);

  // Pré-carrega as 2 fontes do restaurante assim que o módulo abre — deixa em cache
  // pra que o preview do PDF já abra na fonte certa, sem os ~5s de antes.
  useEffect(() => {
    if (!sharedLayout) return;
    return carregarFontesCardapio(sharedLayout.fonteTitulos, sharedLayout.fonteCorpo, sharedLayout.fontesCustom || []);
  }, [sharedLayout]);

  // Salva só a LISTA (nome/add/remove/capa) — preserva as seções de cada cardápio.
  async function salvarLista(next: CardapioMenu[]) {
    setCardapios(next);
    const ref = doc(db, "cardapioEstruturado", rid);
    const snap = await getDoc(ref);
    const atual = (snap.exists() ? (snap.data() as CardapioEstruturado).cardapios : []) || [];
    const merged = next.map((n) => { const cur = atual.find((c) => c.id === n.id); return cur ? { ...cur, nome: n.nome, tituloCapa: n.tituloCapa, temCapa: n.temCapa } : n; });
    await setDoc(ref, sanitizeForFirestore({ id: rid, restaurantId: rid, cardapios: merged, atualizadoEm: new Date().toISOString(), atualizadoPor: me?.id }), { merge: true }).catch(() => {});
  }
  function addMenu() {
    const nome = window.prompt("Nome do novo cardápio (ex: Bebidas, Vinhos):")?.trim();
    if (!nome) return;
    const m: CardapioMenu = { id: uid(), nome, tituloCapa: nome.toUpperCase(), temCapa: false, secoes: [] };
    void salvarLista([...(cardapios || []), m]); setSel(m.id);
  }
  function renomear(id: string) {
    const m = cardapios?.find((c) => c.id === id);
    const nome = window.prompt("Renomear cardápio:", m?.nome)?.trim();
    if (!nome) return;
    void salvarLista((cardapios || []).map((c) => c.id === id ? { ...c, nome } : c));
  }
  function excluir(id: string) {
    const m = cardapios?.find((c) => c.id === id);
    if (!window.confirm(`Excluir o cardápio "${m?.nome}"? Os itens dele serão apagados.`)) return;
    const next = (cardapios || []).filter((c) => c.id !== id);
    void salvarLista(next); if (sel === id) setSel(next[0]?.id || "");
  }

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (!podeVer) return <div className="max-w-2xl mx-auto py-12 text-center"><div className="text-4xl mb-3">🔒</div><p className="text-gray-600 dark:text-gray-400">Você não tem acesso ao Cardápio.</p></div>;
  if (cardapios === null) return <div className="text-gray-400 py-12 text-center text-sm">Carregando…</div>;

  const atual = cardapios.find((c) => c.id === sel);

  return (
    <div className="max-w-5xl mx-auto py-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">📋 Cardápios — {restaurant.nome}</h2>
      <p className="text-[13px] text-gray-500 dark:text-gray-400">Monte aqui os cardápios do restaurante. O site puxa estas informações — atualizou aqui, atualiza lá.</p>


      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 overflow-x-auto whitespace-nowrap">
        {cardapios.map((c) => (
          <button key={c.id} type="button" onClick={() => setSel(c.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${sel === c.id ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-gray-500"}`}>
            {c.nome}
          </button>
        ))}
        {podeEditar && <button type="button" onClick={addMenu} className="px-3 py-2 text-sm font-medium text-indigo-600">+ Novo cardápio</button>}
        <span className="flex-1" />
        <button type="button" onClick={() => setSel(CONFIG)}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${sel === CONFIG ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-gray-500"}`}>
          ⚙️ Configurações
        </button>
      </div>

      {sel === CONFIG ? (
        <CardapioConfig rid={rid} podeEditar={podeEditar} atualizadoPor={me?.id} />
      ) : cardapios.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl space-y-2">
          <p className="text-sm text-gray-400">Nenhum cardápio ainda.</p>
          {podeEditar && <button type="button" onClick={addMenu} className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white">+ Criar primeiro cardápio</button>}
        </div>
      ) : atual ? (
        <div className="space-y-3">
          {podeEditar && (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-gray-400">Cardápio selecionado: <strong className="text-gray-600 dark:text-gray-300">{atual.nome}</strong></span>
              <button type="button" onClick={() => renomear(atual.id)} className="text-[12px] text-indigo-600 hover:underline">renomear</button>
              <button type="button" onClick={() => excluir(atual.id)} className="text-[12px] text-rose-600 hover:underline">excluir</button>
            </div>
          )}
          <CardapioEditor key={atual.id} rid={rid} menuId={atual.id} nomeMenu={atual.nome} podeEditar={podeEditar} nomeRestaurante={restaurant.nome}
            sharedLayout={sharedLayout || undefined} menuLayoutProprio={!!atual.layoutProprio} menuLayout={atual.layout} />
        </div>
      ) : null}
    </div>
  );
}
