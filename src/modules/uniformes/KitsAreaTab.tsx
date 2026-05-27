// Tab "🧰 Kits por Área" — kit padrão de uniformes/EPIs por área.
// Bate com `cargo.area` (cada área do restaurante define seu kit base).

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import type { Cargo, ItemUniforme, KitAreaUniforme, Pessoa } from "../../core/types";
import { salvarKitArea } from "../../core/uniformes/uniformesHelpers";

type Props = {
  itens: ItemUniforme[];
  kits: KitAreaUniforme[];
  podeConfig: boolean;
  pessoa: Pessoa;
  restaurantId: string;
};

export function KitsAreaTab({ itens, kits, podeConfig, pessoa, restaurantId }: Props) {
  // Áreas vêm dos cargos cadastrados — assim ficam sincronizadas com o resto
  const [cargos, setCargos] = useState<Cargo[]>([]);
  useEffect(() => {
    if (!restaurantId) return;
    const unsub = onSnapshot(
      query(collection(db, "cargos"), where("restaurantId", "==", restaurantId)),
      (snap) => setCargos(snap.docs.map(d => ({ ...d.data(), id: d.id }) as Cargo)),
    );
    return () => unsub();
  }, [restaurantId]);

  // Lista de áreas únicas dos cargos
  const areas = useMemo(() => {
    const set = new Set<string>();
    cargos.forEach(c => { if (c.area) set.add(c.area); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [cargos]);

  const [areaAtiva, setAreaAtiva] = useState<string | null>(null);
  useEffect(() => {
    if (!areaAtiva && areas.length > 0) setAreaAtiva(areas[0]!);
  }, [areas, areaAtiva]);

  if (areas.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-gray-500 dark:text-gray-400 italic">
        Nenhuma área cadastrada nos cargos. Vá em <strong>Pessoas → Cargos</strong> pra
        cadastrar áreas, depois volta aqui.
      </div>
    );
  }

  const kitAtivo = areaAtiva ? kits.find(k => k.area === areaAtiva) : null;

  return (
    <div className="space-y-3">
      {/* Tabs por área (chips) */}
      <div className="flex flex-wrap gap-1.5 pb-2 border-b border-gray-200 dark:border-gray-800">
        {areas.map(a => (
          <button
            key={a}
            type="button"
            onClick={() => setAreaAtiva(a)}
            className={`px-3 py-1.5 text-xs rounded-full font-medium ${
              areaAtiva === a
                ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300"
                : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {areaAtiva && (
        <KitEditor
          key={areaAtiva}
          area={areaAtiva}
          kit={kitAtivo}
          itens={itens}
          podeConfig={podeConfig}
          pessoa={pessoa}
          restaurantId={restaurantId}
        />
      )}
    </div>
  );
}

function KitEditor({
  area, kit, itens, podeConfig, pessoa, restaurantId,
}: {
  area: string;
  kit: KitAreaUniforme | null | undefined;
  itens: ItemUniforme[];
  podeConfig: boolean;
  pessoa: Pessoa;
  restaurantId: string;
}) {
  // Estado local — sincroniza com kit quando ele muda
  const [linhas, setLinhas] = useState<KitAreaUniforme["itens"]>(() => kit?.itens || []);
  useEffect(() => { setLinhas(kit?.itens || []); }, [kit]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const itensAtivos = useMemo(() => itens.filter(i => i.ativo), [itens]);

  function add() {
    setLinhas(prev => [...prev, { itemId: "", quantidade: 1 }]);
  }
  function remover(idx: number) {
    setLinhas(prev => prev.filter((_, i) => i !== idx));
  }
  function atualizar(idx: number, patch: Partial<KitAreaUniforme["itens"][0]>) {
    setLinhas(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }

  async function salvar() {
    setErro("");
    // Valida
    for (const l of linhas) {
      if (!l.itemId) { setErro("Selecione um item em todas as linhas."); return; }
      if (!l.quantidade || l.quantidade < 1) { setErro("Quantidade inválida."); return; }
    }
    setSalvando(true);
    try {
      await salvarKitArea({ restaurantId, area, itens: linhas, pessoa });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4 bg-white dark:bg-gray-900/40">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold text-base text-gray-900 dark:text-gray-100">
            Kit padrão · <span className="text-indigo-700 dark:text-indigo-400">{area}</span>
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Itens entregues por padrão quando alguém dessa área é admitido.
            Editável por empregado na hora da entrega.
          </p>
        </div>
        {podeConfig && (
          <Button size="sm" onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar kit"}
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        {linhas.map((l, idx) => {
          const item = itens.find(i => i.id === l.itemId);
          const variacoes = item?.variacoes || [];
          return (
            <div key={idx} className="grid grid-cols-[1fr_140px_70px_30px] gap-1.5">
              <select
                value={l.itemId}
                onChange={(e) => atualizar(idx, { itemId: e.target.value, variacaoId: undefined })}
                disabled={!podeConfig}
                className="px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              >
                <option value="">— item —</option>
                {itensAtivos.map(i => (
                  <option key={i.id} value={i.id}>
                    {i.tipo === "epi" ? "🛡️" : "🦺"} {i.nome}
                  </option>
                ))}
              </select>
              <select
                value={l.variacaoId || ""}
                onChange={(e) => atualizar(idx, { variacaoId: e.target.value || undefined })}
                disabled={!podeConfig || !item}
                className="px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              >
                <option value="">qualquer tamanho</option>
                {variacoes.map(v => (
                  <option key={v.id} value={v.id}>{v.tamanho}</option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                value={l.quantidade}
                onChange={(e) => atualizar(idx, { quantidade: parseInt(e.target.value, 10) || 0 })}
                disabled={!podeConfig}
                className="px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums"
              />
              {podeConfig && (
                <button
                  type="button"
                  onClick={() => remover(idx)}
                  className="text-rose-500 hover:text-rose-700 text-sm"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
        {linhas.length === 0 && (
          <div className="text-xs text-gray-400 italic text-center py-4">
            Nenhum item no kit. Adicione abaixo.
          </div>
        )}
      </div>

      {podeConfig && (
        <button
          type="button"
          onClick={add}
          className="w-full mt-2 px-3 py-2 rounded border border-dashed border-gray-300 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          + adicionar item ao kit
        </button>
      )}

      {erro && <div className="text-xs text-rose-600 dark:text-rose-400 mt-2">{erro}</div>}
    </div>
  );
}
