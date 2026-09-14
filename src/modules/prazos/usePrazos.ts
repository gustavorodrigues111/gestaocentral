// ════════════════════════════════════════════════════════════════════════════
//  usePrazos — escuta a coleção `prazos` com o MESMO escopo de permissão do
//  PrazosPage (empresa ativa · todas-que-tenho-acesso · master vê tudo). Extraído
//  pra o módulo "Tarefas e Prazos" ler prazos sem duplicar a lógica de query.
//  Não filtra por categoria (ver conta/técnico/…): isso é decisão de RENDER de
//  quem consome (aplique podeVerCat na exibição), aqui só resolvemos o alcance
//  por empresa — igual PrazosPage.tsx.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { Prazo } from "../../core/types";

export function usePrazos(
  rid: string | undefined,
  opts: { isMaster: boolean; meRests: string[]; todasEmpresas: boolean },
): Prazo[] {
  const { isMaster, meRests, todasEmpresas } = opts;
  const [prazos, setPrazos] = useState<Prazo[]>([]);
  // chave estável do array pra dependência do effect (evita re-subscrição à toa)
  const meRestsKey = meRests.join(",");
  useEffect(() => {
    if (!rid) { setPrazos([]); return; }
    const restList = meRestsKey ? meRestsKey.split(",") : [rid];
    const qy = !todasEmpresas
      ? query(collection(db, "prazos"), where("restaurantIds", "array-contains", rid))
      : isMaster
        ? collection(db, "prazos")
        : query(collection(db, "prazos"), where("restaurantIds", "array-contains-any", restList.length ? restList : [rid]));
    return onSnapshot(
      qy,
      (s) => setPrazos(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Prazo).filter((p) => !p.deletadoEm)),
      () => setPrazos([]),
    );
  }, [rid, isMaster, todasEmpresas, meRestsKey]);
  return prazos;
}
