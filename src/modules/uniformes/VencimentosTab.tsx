// Tab "⏳ Vencimentos" — itens entregues vencendo nos próximos N dias.

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { EntregaUniforme } from "../../core/types";
import { itensProximosVencimento } from "../../core/uniformes/uniformesHelpers";

type Props = {
  entregas: EntregaUniforme[];
  diasAlerta: number;
};

export function VencimentosTab({ entregas, diasAlerta }: Props) {
  const [horizonte, setHorizonte] = useState(diasAlerta);

  // Pessoas pra resolver nomes
  const [pessoas, setPessoas] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const rids = new Set(entregas.map(e => e.restaurantId));
    if (rids.size === 0) return;
    const r = Array.from(rids)[0];
    if (!r) return;
    const unsub = onSnapshot(
      query(collection(db, "pessoas"), where("restaurantIds", "array-contains", r)),
      (snap) => {
        const m = new Map<string, string>();
        snap.docs.forEach(d => {
          m.set(d.id, (d.data() as { nome?: string }).nome || "?");
        });
        setPessoas(m);
      },
    );
    return () => unsub();
  }, [entregas]);

  const proxs = useMemo(
    () => itensProximosVencimento(entregas, horizonte),
    [entregas, horizonte],
  );
  const vencidos    = proxs.filter(p => p.item.vencido);
  const aVencer     = proxs.filter(p => !p.item.vencido);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 dark:text-gray-400">Horizonte:</label>
        <select
          value={horizonte}
          onChange={(e) => setHorizonte(parseInt(e.target.value, 10))}
          className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        >
          {[15, 30, 60, 90, 180].map(d => (
            <option key={d} value={d}>{d} dias</option>
          ))}
        </select>
        <span className="text-xs text-gray-500 ml-2">
          {proxs.length} item(ns) total · {vencidos.length} vencidos · {aVencer.length} a vencer
        </span>
      </div>

      {vencidos.length > 0 && (
        <Section
          titulo="🚨 Já vencidos"
          itens={vencidos}
          pessoas={pessoas}
          tom="vermelho"
        />
      )}
      {aVencer.length > 0 && (
        <Section
          titulo={`⏳ Próximos ${horizonte} dias`}
          itens={aVencer}
          pessoas={pessoas}
          tom="amber"
        />
      )}
      {proxs.length === 0 && (
        <div className="text-center py-10 text-sm text-gray-500 dark:text-gray-400 italic">
          Nenhum item vencendo nos próximos {horizonte} dias.
        </div>
      )}
    </div>
  );
}

function Section({
  titulo, itens, pessoas, tom,
}: {
  titulo: string;
  itens: ReturnType<typeof itensProximosVencimento>;
  pessoas: Map<string, string>;
  tom: "vermelho" | "amber";
}) {
  const corBorda = tom === "vermelho"
    ? "border-rose-200 dark:border-rose-900"
    : "border-amber-200 dark:border-amber-900";
  const corFundo = tom === "vermelho"
    ? "bg-rose-50/30 dark:bg-rose-900/10"
    : "bg-amber-50/30 dark:bg-amber-900/10";

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">{titulo}</h3>
      <div className={`rounded-lg border ${corBorda} ${corFundo}`}>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left">Pessoa</th>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-center">Tipo</th>
              <th className="px-3 py-2 text-right">Validade</th>
              <th className="px-3 py-2 text-right">Restam</th>
            </tr>
          </thead>
          <tbody>
            {itens.map(({ entrega, item }, idx) => (
              <tr key={`${entrega.id}__${item.itemId}__${idx}`} className="border-t border-gray-200 dark:border-gray-800">
                <td className="px-3 py-2">{pessoas.get(entrega.pessoaId) || entrega.pessoaId}</td>
                <td className="px-3 py-2">
                  {item.nome} {item.tamanho && <span className="text-gray-500">· {item.tamanho}</span>}
                  {" "}<span className="text-gray-500">×{item.qtd}</span>
                </td>
                <td className="px-3 py-2 text-center">{entrega.tipo === "epi" ? "🛡️" : "🦺"}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {item.validadeAte
                    ? new Date(item.validadeAte + "T12:00:00").toLocaleDateString("pt-BR")
                    : "—"}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                  item.vencido ? "text-rose-700 dark:text-rose-400" : "text-amber-700 dark:text-amber-400"
                }`}>
                  {item.vencido ? `vencido há ${Math.abs(item.diasRestantes)}d` : `${item.diasRestantes}d`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
