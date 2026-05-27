// Tab "📋 Entregas" — lista cronológica de todas as entregas + nova entrega + devolução.

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import type {
  EntregaUniforme, ItemUniforme, KitAreaUniforme, Pessoa, Restaurant, TipoItemUniforme,
} from "../../core/types";
import { NovaEntregaModal } from "./NovaEntregaModal";
import { DevolucaoModal } from "./DevolucaoModal";

type Props = {
  itens: ItemUniforme[];
  kits: KitAreaUniforme[];
  entregas: EntregaUniforme[];
  podeConfig: boolean;
  pessoa: Pessoa;
  restaurantId: string;
  activeRestaurant: Restaurant;
};

type FiltroTipo = "todos" | "uniforme" | "epi";
type FiltroStatus = "todas" | "ativas" | "devolvidas";

export function EntregasTab({
  itens, kits, entregas, podeConfig, pessoa, restaurantId, activeRestaurant,
}: Props) {
  const [pessoas, setPessoas] = useState<Map<string, { nome: string; cpf: string }>>(new Map());
  useEffect(() => {
    if (!restaurantId) return;
    const unsub = onSnapshot(
      query(collection(db, "pessoas"), where("restaurantId", "==", restaurantId)),
      (snap) => {
        const m = new Map<string, { nome: string; cpf: string }>();
        snap.docs.forEach(d => {
          const data = d.data() as { nome?: string; cpf?: string };
          m.set(d.id, { nome: data.nome || "?", cpf: data.cpf || "" });
        });
        setPessoas(m);
      },
    );
    return () => unsub();
  }, [restaurantId]);

  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("todos");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("ativas");
  const [busca, setBusca] = useState("");
  const [novaTipoForm, setNovaTipoForm] = useState<TipoItemUniforme | null>(null);
  const [devolverEntrega, setDevolverEntrega] = useState<EntregaUniforme | null>(null);

  const filtradas = useMemo(() => {
    let r = entregas;
    if (filtroTipo !== "todos") r = r.filter(e => e.tipo === filtroTipo);
    if (filtroStatus === "ativas") r = r.filter(e => !e.devolucao);
    else if (filtroStatus === "devolvidas") r = r.filter(e => !!e.devolucao);
    if (busca.trim()) {
      const q = busca.toLowerCase();
      r = r.filter(e => {
        const p = e.pessoaId ? pessoas.get(e.pessoaId) : null;
        const nome = p?.nome || e.candidatoSnapshot?.nome || "";
        return nome.toLowerCase().includes(q);
      });
    }
    return [...r].sort((a, b) => b.entregueEm.localeCompare(a.entregueEm));
  }, [entregas, filtroTipo, filtroStatus, busca, pessoas]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {([
            ["todos", "Todos"],
            ["uniforme", "🦺 Uniformes"],
            ["epi", "🛡️ EPIs"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFiltroTipo(id)}
              className={`px-2.5 py-1 text-xs rounded-full font-medium ${
                filtroTipo === id
                  ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value as FiltroStatus)}
          className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        >
          <option value="ativas">Ativas (não devolvidas)</option>
          <option value="devolvidas">Devolvidas</option>
          <option value="todas">Todas</option>
        </select>
        <input
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome…"
          className="flex-1 max-w-xs px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        />
        {podeConfig && (
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setNovaTipoForm("uniforme")}>
              + Entrega de uniforme
            </Button>
            <Button size="sm" onClick={() => setNovaTipoForm("epi")}>
              + Entrega de EPI
            </Button>
          </div>
        )}
      </div>

      {filtradas.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-500 dark:text-gray-400 italic">
          Nenhuma entrega registrada.
        </div>
      ) : (
        <div className="space-y-2">
          {filtradas.map(e => (
            <EntregaRow
              key={e.id}
              entrega={e}
              pessoa={e.pessoaId ? pessoas.get(e.pessoaId) : undefined}
              podeConfig={podeConfig}
              onDevolver={() => setDevolverEntrega(e)}
            />
          ))}
        </div>
      )}

      {novaTipoForm && (
        <NovaEntregaModal
          tipo={novaTipoForm}
          itens={itens}
          kits={kits}
          restaurantId={restaurantId}
          activeRestaurant={activeRestaurant}
          pessoa={pessoa}
          onClose={() => setNovaTipoForm(null)}
        />
      )}

      {devolverEntrega && (
        <DevolucaoModal
          entrega={devolverEntrega}
          itens={itens}
          pessoa={pessoa}
          onClose={() => setDevolverEntrega(null)}
        />
      )}
    </div>
  );
}

function EntregaRow({
  entrega, pessoa, podeConfig, onDevolver,
}: {
  entrega: EntregaUniforme;
  pessoa?: { nome: string; cpf: string };
  podeConfig: boolean;
  onDevolver: () => void;
}) {
  const total = entrega.itens.reduce((s, i) => s + (i.custoUnit * i.qtd), 0);
  const data = new Date(entrega.entregueEm).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const totalQtd = entrega.itens.reduce((s, i) => s + i.qtd, 0);

  return (
    <div className={`rounded-lg border p-3 ${
      entrega.devolucao
        ? "border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-900/20 opacity-80"
        : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40"
    }`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">
              {pessoa?.nome || entrega.candidatoSnapshot?.nome || entrega.pessoaId || "?"}
            </span>
            {!entrega.pessoaId && entrega.admissaoId && (
              <span className="text-[10px] uppercase tracking-wider font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded">
                em admissão
              </span>
            )}
            <span className={`text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${
              entrega.tipo === "epi"
                ? "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300"
                : "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300"
            }`}>
              {entrega.tipo === "epi" ? "🛡️ EPI" : "🦺 Uniforme"}
            </span>
            <span className="text-[10px] text-gray-500">{data}</span>
            {entrega.motivo !== "admissao" && (
              <span className="text-[10px] uppercase tracking-wider text-gray-500">· {entrega.motivo}</span>
            )}
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            {totalQtd} peça(s) · R$ {total.toFixed(2)} · entregue por {entrega.entreguePor.nome}
          </div>
        </div>
        {podeConfig && !entrega.devolucao && (
          <button
            type="button"
            onClick={onDevolver}
            className="text-[10px] px-2 py-1 rounded border border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-900/20 text-rose-700 dark:text-rose-300 whitespace-nowrap"
          >
            registrar devolução
          </button>
        )}
        {entrega.devolucao && (
          <span className="text-[10px] uppercase tracking-wider font-bold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-1.5 py-0.5 rounded whitespace-nowrap">
            ↶ devolvido
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
        {entrega.itens.map((i, idx) => (
          <div key={idx} className="flex items-baseline gap-2 px-2 py-1 rounded bg-gray-50 dark:bg-gray-900/40">
            <span className="font-medium flex-1 truncate">{i.nome}</span>
            {i.tamanho && <span className="text-gray-500">· {i.tamanho}</span>}
            <span className="tabular-nums">×{i.qtd}</span>
            {i.validadeAte && (
              <span className="text-[10px] text-gray-500" title="validade até">
                até {new Date(i.validadeAte + "T12:00:00").toLocaleDateString("pt-BR")}
              </span>
            )}
          </div>
        ))}
      </div>

      {entrega.devolucao && (
        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-800 text-[10px] text-gray-500">
          Devolução registrada em {new Date(entrega.devolucao.devolvidoEm).toLocaleDateString("pt-BR")}
          {" "}por {entrega.devolucao.devolvidoPor.nome}
          {entrega.devolucao.observacao && (
            <span className="italic"> · "{entrega.devolucao.observacao}"</span>
          )}
        </div>
      )}
    </div>
  );
}
