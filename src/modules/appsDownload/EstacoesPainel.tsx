// Estações do Painel do Salão (seção master dentro de Download de Apps).
// Master gera um "código de estação" por restaurante; a estação de parede
// (rota /painel-estacao) usa esse código pra puxar o feed read-only. Revogável.
import { useEffect, useMemo, useState } from "react";
import { MonitorPlay, Plus, Trash2, Copy, Check, Power } from "lucide-react";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import * as repo from "./estacoesRepo";
import type { EstacaoToken } from "./estacoesRepo";

const INPUT = "w-full h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm";

function Copiavel({ texto, label }: { texto: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => {}); }}
      className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-medium max-w-full"
      title={`Copiar ${label}`}
    >
      {ok ? <Check size={13} className="text-emerald-600 shrink-0" /> : <Copy size={13} className="shrink-0" />}
      <span className="truncate font-mono">{texto}</span>
    </button>
  );
}

export function EstacoesPainel() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const [estacoes, setEstacoes] = useState<EstacaoToken[]>([]);
  const [nome, setNome] = useState("");
  const [rid, setRid] = useState("");
  const [criando, setCriando] = useState(false);

  useEffect(() => repo.ouvirEstacoes(setEstacoes), []);
  const origin = typeof window !== "undefined" ? window.location.origin : "https://admin.planejamento.app";
  const podeCriar = useMemo(() => nome.trim().length > 0 && !!rid, [nome, rid]);

  async function criar() {
    const rest = restaurants.find((r) => r.id === rid);
    if (!rest) return;
    setCriando(true);
    await repo.criarEstacao({
      id: repo.gerarToken(), nome: nome.trim(), restaurantId: rid, restaurantNome: rest.nome || "Restaurante",
      ativo: true, criadoEm: new Date().toISOString(), criadoPor: me?.nome || me?.id || null,
    });
    setNome(""); setRid(""); setCriando(false);
  }

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 mt-6">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 grid place-items-center"><MonitorPlay size={18} /></div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold leading-tight">Estações do Painel do Salão</h2>
          <p className="text-xs text-gray-500">Cada estação (tela de parede) ganha um código read-only de 1 restaurante. Abra <code>/painel-estacao</code> no app e cole o código.</p>
        </div>
      </div>

      {/* Nova estação */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 mt-3">
        <input className={INPUT} placeholder="Nome da estação (ex.: Parede do salão)" value={nome} onChange={(e) => setNome(e.target.value)} />
        <select className={INPUT} value={rid} onChange={(e) => setRid(e.target.value)}>
          <option value="">Restaurante…</option>
          {restaurants.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
        </select>
        <button className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg bg-amber-600 text-white text-sm font-semibold disabled:opacity-50" disabled={!podeCriar || criando} onClick={() => void criar()}>
          <Plus size={16} /> Gerar código
        </button>
      </div>

      {/* Lista */}
      <div className="space-y-2 mt-3">
        {estacoes.length === 0 && <div className="text-sm text-gray-400 italic py-2">Nenhuma estação ainda.</div>}
        {estacoes.map((e) => (
          <div key={e.id} className={`rounded-xl border p-3 ${e.ativo ? "border-gray-200 dark:border-gray-700" : "border-amber-300/60 bg-amber-50/40 dark:bg-amber-900/10"}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{e.nome}</span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">{e.restaurantNome}</span>
              {!e.ativo && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-semibold">revogada</span>}
              <div className="ml-auto flex items-center gap-1.5">
                <button onClick={() => void repo.toggleEstacao(e.id, !e.ativo)} className={`inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-semibold ${e.ativo ? "border border-gray-300 dark:border-gray-600" : "bg-emerald-600 text-white"}`} title={e.ativo ? "Revogar" : "Reativar"}>
                  <Power size={13} /> {e.ativo ? "Revogar" : "Reativar"}
                </button>
                <button onClick={() => { if (confirm("Excluir esta estação? O código para de funcionar.")) void repo.excluirEstacao(e.id); }} className="text-gray-400 hover:text-rose-600" title="Excluir"><Trash2 size={15} /></button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              <Copiavel texto={e.id} label="código" />
              <Copiavel texto={`${origin}/painel-estacao?t=${e.id}`} label="link da estação" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
