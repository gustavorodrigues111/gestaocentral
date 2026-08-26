// Tab "👥 Por empregado" — hub operacional de uniformes/EPIs.
//  • lista todos os empregados ativos com cargo/área;
//  • mostra o recebido vs o KIT MÍNIMO da área (falta em vermelho);
//  • filtro "a vencer" (substitui a aba Vencimentos);
//  • "Fazer entrega" por empregado (substitui a aba Entregas).
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import type {
  Cargo, Empregado, EntregaUniforme, ItemUniforme, KitAreaUniforme, Pessoa, Restaurant, TipoItemUniforme,
} from "../../core/types";
import { NovaEntregaModal } from "./NovaEntregaModal";
import { devolucoesDe, restantePorLinha } from "../../core/uniformes/uniformesHelpers";

type Props = {
  itens: ItemUniforme[];
  kits: KitAreaUniforme[];
  entregas: EntregaUniforme[];
  restaurantId: string;
  activeRestaurant: Restaurant;
  me: Pessoa;
  podeConfig: boolean;
};

const DIAS_VENCER = 30;

export function PorEmpregadoTab({ itens, kits, entregas, restaurantId, activeRestaurant, me, podeConfig }: Props) {
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [filtro, setFiltro] = useState<"todos" | "vencer">("todos");
  const [entregaModal, setEntregaModal] = useState<{ pessoaId?: string; tipo: TipoItemUniforme } | null>(null);

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

  const hoje = new Date().toISOString().slice(0, 10);
  const limiteVenc = new Date(Date.now() + DIAS_VENCER * 86400_000).toISOString().slice(0, 10);

  function entregasDoEmp(emp: Empregado): EntregaUniforme[] {
    return entregas.filter(e => !e.cancelamento && (
      (e.empregadoId && e.empregadoId === emp.id)
      || (!!e.pessoaId && !!emp.pessoaId && e.pessoaId === emp.pessoaId)
    ));
  }
  function recebidoPorEmp(emps: EntregaUniforme[]): Map<string, number> {
    const rec = new Map<string, number>();
    for (const e of emps) {
      for (const it of e.itens) rec.set(it.itemId, (rec.get(it.itemId) || 0) + (it.qtd || 0));
      for (const ev of devolucoesDe(e)) for (const dv of ev.itens) rec.set(dv.itemId, (rec.get(dv.itemId) || 0) - (dv.qtd || 0));
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
        const ents = entregasDoEmp(e);
        const rec = recebidoPorEmp(ents);
        const itensKit = (kit?.itens || []).map(req => {
          const have = rec.get(req.itemId) || 0;
          return { itemId: req.itemId, nome: itemNome(req.itemId), minimo: req.quantidade, have, falta: Math.max(0, req.quantidade - have) };
        });
        // Itens entregues vencendo em <= 30d (não vencido há muito não interessa aqui;
        // inclui atrasados também pra cobrar reposição).
        const vencendo = ents.flatMap(en => en.itens
          .filter(it => it.validadeAte && it.validadeAte <= limiteVenc)
          .map(it => ({ nome: it.nome, validadeAte: it.validadeAte!, dias: Math.round((new Date(it.validadeAte! + "T12:00:00").getTime() - new Date(hoje + "T12:00:00").getTime()) / 86400_000) })));
        vencendo.sort((a, b) => a.validadeAte.localeCompare(b.validadeAte));
        // Peças em posse (histórico de entregas não canceladas), com data de
        // entrega e validade de cada. Vencendo/vencido no topo.
        const emPosse = ents.flatMap(en => {
          const rest = restantePorLinha(en);   // mesma ordem/tamanho de en.itens
          return (en.itens || []).map((it, idx) => ({
            nome: it.nome,
            tamanho: it.tamanho,
            qtd: rest[idx]?.qtdRestante ?? it.qtd,   // desconta o que já foi devolvido
            tipo: en.tipo,
            entregueEm: (en.entregueEm || "").slice(0, 10),
            validadeAte: it.validadeAte || null,
            dias: it.validadeAte ? Math.round((new Date(it.validadeAte + "T12:00:00").getTime() - new Date(hoje + "T12:00:00").getTime()) / 86400_000) : null,
          })).filter(p => p.qtd > 0);
        });
        emPosse.sort((a, b) => (a.validadeAte || "9999").localeCompare(b.validadeAte || "9999") || b.entregueEm.localeCompare(a.entregueEm));
        return { emp: e, cargo, area, itensKit, pendencias: itensKit.filter(i => i.falta > 0).length, semKit: !!area && !kit, vencendo, emPosse };
      })
      .filter(l => !!l.area);
    out.sort((a, b) => (b.pendencias - a.pendencias) || a.emp.nome.localeCompare(b.emp.nome, "pt-BR"));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empregados, cargoById, kitByArea, entregas, itens]);

  const visiveis = filtro === "vencer" ? linhas.filter(l => l.vencendo.length > 0) : linhas;
  const totalPend = linhas.reduce((s, l) => s + l.pendencias, 0);
  const totalVenc = linhas.reduce((s, l) => s + l.vencendo.length, 0);

  return (
    <div className="space-y-3">
      {/* Filtro */}
      <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
        {([["todos", "Todos"], ["vencer", `A vencer (${totalVenc})`]] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setFiltro(v)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md ${filtro === v ? "bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 shadow-sm" : "text-gray-500 dark:text-gray-400"}`}>
            {l}
          </button>
        ))}
      </div>

      {filtro === "todos" && totalPend > 0 && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-300">
          ⚠ <strong>{totalPend}</strong> item(ns) abaixo do mínimo do kit.
        </div>
      )}

      {visiveis.length === 0 ? (
        <div className="text-center py-12 text-gray-500">{filtro === "vencer" ? "Nada vencendo nos próximos 30 dias." : "Nenhum empregado ativo com cargo/área."}</div>
      ) : visiveis.map(({ emp, cargo, area, itensKit, pendencias, semKit, vencendo, emPosse }) => (
        <div key={emp.id} className={`rounded-xl border overflow-hidden bg-white dark:bg-gray-900 ${pendencias > 0 && filtro === "todos" ? "border-red-200 dark:border-red-800" : "border-gray-200 dark:border-gray-800"}`}>
          <div className="p-3 flex items-center justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <span className="font-semibold text-gray-900 dark:text-gray-100">{emp.nome}</span>
              <span className="ml-2 text-xs text-gray-500">{cargo?.nome}{area ? ` · ${area}` : ""}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {filtro === "todos" && (semKit
                ? <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">sem kit na área</span>
                : pendencias > 0
                ? <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">{pendencias} abaixo</span>
                : <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">em dia</span>)}
              {podeConfig && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setEntregaModal({ pessoaId: emp.pessoaId || undefined, tipo: "uniforme" })}>👕 Uniforme</Button>
                  <Button size="sm" variant="secondary" onClick={() => setEntregaModal({ pessoaId: emp.pessoaId || undefined, tipo: "epi" })}>🦺 EPI</Button>
                </>
              )}
            </div>
          </div>

          {filtro === "vencer" ? (
            <div className="px-3 pb-3 space-y-1">
              {vencendo.map((v, i) => (
                <div key={i} className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-sm ${v.dias < 0 ? "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300" : "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300"}`}>
                  <span className="min-w-0 truncate">{v.nome}</span>
                  <span className="tabular-nums shrink-0">{v.validadeAte.split("-").reverse().join("/")} · {v.dias < 0 ? `${-v.dias}d atrasado` : `${v.dias}d`}</span>
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Kit da área — mínimo vs. em posse (ou aviso se a área não tem kit) */}
              {semKit ? (
                <div className="px-3 pb-2 text-xs text-gray-500">Defina o kit da área <strong>{area}</strong> em Configurações pra controlar o mínimo.</div>
              ) : (
                <div className="px-3 pb-2 space-y-1">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-gray-400 mb-0.5">Kit da área (mínimo)</div>
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
              {/* Peças em posse — data de entrega + validade (sempre, mesmo sem kit) */}
              {emPosse.length === 0 ? (
                <div className="px-3 pb-3 text-xs text-gray-400">Nenhuma peça entregue ainda.</div>
              ) : (
                <div className="px-3 pb-3">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-gray-400 mb-1">
                    Em posse ({emPosse.reduce((s, p) => s + (p.qtd || 0), 0)} peça(s))
                  </div>
                  <div className="space-y-1">
                    {emPosse.map((p, i) => (
                      <div key={i} className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-sm ${
                        p.dias != null && p.dias < 0 ? "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300"
                          : p.dias != null && p.dias <= 30 ? "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300"
                          : "bg-gray-50 dark:bg-gray-800/40 text-gray-700 dark:text-gray-200"
                      }`}>
                        <span className="min-w-0 truncate">{p.tipo === "epi" ? "🦺" : "👕"} {p.qtd}× {p.nome}{p.tamanho && p.tamanho !== "único" ? ` (${p.tamanho})` : ""}</span>
                        <span className="tabular-nums shrink-0 text-xs">
                          {p.entregueEm ? p.entregueEm.split("-").reverse().join("/") : "—"}
                          {p.validadeAte ? ` · ${p.dias != null && p.dias < 0 ? `venceu há ${-p.dias}d` : `vence em ${p.dias}d`}` : " · sem validade"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ))}

      {entregaModal && (
        <NovaEntregaModal
          tipo={entregaModal.tipo}
          itens={itens}
          kits={kits}
          restaurantId={restaurantId}
          activeRestaurant={activeRestaurant}
          pessoa={me}
          pessoaInicialId={entregaModal.pessoaId}
          onClose={() => setEntregaModal(null)}
        />
      )}
    </div>
  );
}
