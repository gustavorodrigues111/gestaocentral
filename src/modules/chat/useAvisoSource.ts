// ════════════════════════════════════════════════════════════════════════════
//  useAvisoSource — assinatura genérica de uma fonte de avisos da Central
//
//  Cada fonte de aviso (escala, fale com DP, fechamento de caixa, …) é uma
//  coleção Firestore filtrada por um conjunto de restaurantes onde a pessoa
//  tem a permissão de receber aquele aviso. Este hook centraliza o boilerplate:
//
//   • calcula os restaurantes permitidos via `gate(rid)`
//   • abre um listener por restaurante (transversal ao usuário)
//   • devolve os docs agrupados por restaurantId
//
//  O componente chama este hook UMA VEZ por tipo de fonte (contagem estática,
//  respeita as regras de hooks) e transforma os docs em avisos com um builder
//  próprio. Filtros simples (status === "x") vão nos `where`; lógica de data
//  ("vencendo") fica no builder, client-side.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where, type WhereFilterOp } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { canAcao } from "../../core/auth/permissions";
import type { Pessoa, AccessProfile, Restaurant } from "../../core/types";

export type AvisoSourceFiltro = [field: string, op: WhereFilterOp, value: unknown];

export type AvisoDoc = { id: string; restaurantId: string; [k: string]: unknown };

export function useAvisoSource(opts: {
  restaurants: Restaurant[];
  pessoa: Pessoa | null;
  perfis: AccessProfile[];
  /** Permissão exigida pra receber esse aviso (uma ou mais — OR). */
  gates: Array<[moduleId: string, actionId: string]>;
  collectionName: string;
  /** Filtros `where` aplicados além de restaurantId. */
  filtros?: AvisoSourceFiltro[];
}): Record<string, AvisoDoc[]> {
  const { restaurants, pessoa, perfis, gates, collectionName, filtros } = opts;

  const rids = useMemo(
    () => restaurants
      .filter((r) => gates.some(([m, a]) => canAcao(pessoa, r.id, m, a, perfis)))
      .map((r) => r.id),
    // gates/filtros são literais estáveis por chamada; deps relevantes abaixo
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [restaurants, pessoa, perfis],
  );
  const ridsKey = rids.join(",");
  const filtrosKey = JSON.stringify(filtros || []);

  const [porRid, setPorRid] = useState<Record<string, AvisoDoc[]>>({});

  useEffect(() => {
    if (rids.length === 0) { setPorRid({}); return; }
    setPorRid({});
    const unsubs = rids.map((rid) => {
      const clauses = [where("restaurantId", "==", rid), ...(filtros || []).map((f) => where(f[0], f[1], f[2]))];
      return onSnapshot(
        query(collection(db, collectionName), ...clauses),
        (snap) => {
          const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })) as AvisoDoc[];
          setPorRid((prev) => ({ ...prev, [rid]: arr }));
        },
      );
    });
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ridsKey, collectionName, filtrosKey]);

  return porRid;
}
