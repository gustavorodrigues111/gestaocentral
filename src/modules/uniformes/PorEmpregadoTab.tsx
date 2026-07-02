// Tab "👥 Por empregado" — lista todos os empregados ativos com cargo e mostra,
// pra cada um, o que já recebeu de uniforme/EPI vs o KIT MÍNIMO da área do
// cargo. Falta em relação ao mínimo → destaque vermelho (controle).
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { Cargo, Empregado, EntregaUniforme, ItemUniforme, KitAreaUniforme } from "../../core/types";

type Props = {
  itens: ItemUniforme[];
  kits: KitAreaUniforme[];
  entregas: EntregaUniforme[];
  restaurantId: string;
};

export function PorEmpregadoTab({ itens, kits, entregas, restaurantId }: Props) {
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);

  useEffect(() => {
    if (!restaurantId) return;
    const u1 = onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", restaurantId)),
      (snap) => setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() } as Empregado))));
    const u2 = onSnapshot(query(collection(db, "cargos"), where("restaurantId", "==", restaurantId)),
      (snap) => setCargos(snap.docs.map(d => ({ id: d.id, ...d.data() } as Cargo))));
    return () => { u1(); u2(); };
  }, [restaurantId]);

  const cargoById = useMemo(() => new Map(cargos.map(c => [c.id, c])), [cargos]);
  const kitByArea = useMemo(() => new Map(kits.map(k => [k.area, k])), [kits]);
  const itemNome = useMemo(() => {
    const m = new Map(itens.map(i => [i.id, i.nome]));
    return (id: string) => m.get(id) || "item";
  }, [itens]);

  // Quantidade líquida que o empregado tem hoje, por itemId (entregas ativas
  // menos devoluções, ignorando entregas canceladas).
  function recebidoPorEmp(emp: Empregado): Map<string, number> {
    const rec = new Map<string, number>();
    for (const e of entregas) {
      if (e.cancelamento) continue;
      const daPessoa = (e.empregadoId && e.empregadoId === emp.id)
        || (!!e.pessoaId && !!emp.pessoaId && e.pessoaId === emp.pessoaId);
      if (!daPessoa) continue;
      for (const it of e.itens) rec.set(it.itemId, (rec.get(it.itemId) || 0) + (it.qtd || 0));
      for (const dv of e.devolucao?.itens || []) rec.set(dv.itemId, (rec.get(dv.itemId) || 0) - (dv.qtd || 0));
    }
    return rec;
  }

  const linhas = useMemo(() => {
    const out = empregados
      .filter(e => e.estaAtivo !== false && e.cargoId)
      .map(e => {
        const cargo = e.cargoId ? cargoById.get(e.cargoId) : undefined;
        const area = cargo?.area;
        const kit = area ? kitByArea.get(area) : undefined;
        const rec = recebidoPorEmp(e);
        const itensKit = (kit?.itens || []).map(req => {
          const have = rec.get(req.itemId) || 0;
          const falta = Math.max(0, req.quantidade - have);
          return { itemId: req.itemId, nome: itemNome(req.itemId), minimo: req.quantidade, have, falta };
        });
        const semKit = !!area && !kit;
        return { emp: e, cargo, area, itensKit, pendencias: itensKit.filter(i => i.falta > 0).length, semKit };
      })
      .filter(l => !!l.area); // só quem tem área no cargo
    out.sort((a, b) => (b.pendencias - a.pendencias) || a.emp.nome.localeCompare(b.emp.nome, "pt-BR"));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empregados, cargoById, kitByArea, entregas, itens]);

  if (linhas.length === 0) return <div className="text-center py-12 text-gray-500">Nenhum empregado ativo com cargo/área.</div>;
  const totalPend = linhas.reduce((s, l) => s + l.pendencias, 0);

  return (
    <div className="space-y-3">
      {totalPend > 0 && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-300">
          ⚠ <strong>{totalPend}</strong> item(ns) abaixo do mínimo do kit. Registre a entrega pra ficar em conformidade.
        </div>
      )}
      {linhas.map(({ emp, cargo, area, itensKit, pendencias, semKit }) => (
        <div key={emp.id} className={`rounded-xl border overflow-hidden bg-white dark:bg-gray-900 ${pendencias > 0 ? "border-red-200 dark:border-red-800" : "border-gray-200 dark:border-gray-800"}`}>
          <div className="p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="font-semibold text-gray-900 dark:text-gray-100">{emp.nome}</span>
              <span className="ml-2 text-xs text-gray-500">{cargo?.nome}{area ? ` · ${area}` : ""}</span>
            </div>
            {semKit
              ? <span className="shrink-0 text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">sem kit na área</span>
              : pendencias > 0
              ? <span className="shrink-0 text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">{pendencias} abaixo</span>
              : <span className="shrink-0 text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">em dia</span>}
          </div>
          {semKit ? (
            <div className="px-3 pb-3 text-xs text-gray-500">Defina o kit da área <strong>{area}</strong> em Configurações pra controlar o mínimo.</div>
          ) : (
            <div className="px-3 pb-3 space-y-1">
              {itensKit.length === 0 ? (
                <div className="text-xs text-gray-500">Kit da área sem itens.</div>
              ) : itensKit.map(it => (
                <div key={it.itemId} className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-sm ${
                  it.falta > 0 ? "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300" : "bg-gray-50 dark:bg-gray-800/40 text-gray-700 dark:text-gray-200"
                }`}>
                  <span className="min-w-0 truncate">{it.nome}</span>
                  <span className="tabular-nums shrink-0">
                    {it.have}/{it.minimo}
                    {it.falta > 0 ? <strong className="ml-1">· falta {it.falta}</strong> : <span className="ml-1 text-emerald-600 dark:text-emerald-400">✓</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
