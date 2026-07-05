import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, updateDoc, doc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { MODULES } from "../../config/modules";
import type { ModuleId, Pessoa, Rotina } from "../../core/types";
import { RotinaModal } from "./RotinaModal";
import { AvisosSistemaTab } from "./AvisosSistemaTab";
import { apagarRotina } from "./repository";
import { recorrenciaLabel, proximaData } from "./rotinasEngine";
import { subDestinoLabel } from "./subDestinos";

const moduloLabel = (id?: ModuleId) => {
  if (!id) return null;
  const m = MODULES.find(x => x.id === id);
  return m ? `${m.icon} ${m.label}` : id;
};

export function RotinasPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find(r => r.id === rid) || null;
  const modulosAtivos = restaurant?.modulosAtivos || [];

  const isMaster = !!me?.isMaster;
  const { can, loading: loadingPerfis } = useCanAcao(rid);
  const podeGerenciar = isMaster || can("rotinas", "gerenciar");
  const podeVer = podeGerenciar || can("rotinas", "ver");

  const [rotinas, setRotinas] = useState<Rotina[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Rotina | "new" | null>(null);
  const [tab, setTab] = useState<"sistema" | "rotinas">("sistema");

  useEffect(() => {
    if (!rid) return;
    const unsub = onSnapshot(query(collection(db, "rotinas"), where("restaurantId", "==", rid)), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Rotina);
      list.sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"));
      setRotinas(list);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const unsub = onSnapshot(query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid)), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa).filter(p => p.ativa !== false);
      list.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      setPessoas(list);
    });
    return () => unsub();
  }, [rid]);

  const hoje = new Date().toISOString().slice(0, 10);
  const pessoaNome = useMemo(() => Object.fromEntries(pessoas.map(p => [p.id, p.nome])), [pessoas]);

  async function toggleAtivo(r: Rotina) {
    await updateDoc(doc(db, "rotinas", r.id), { ativo: !r.ativo, atualizadoEm: new Date().toISOString() });
  }
  async function excluir(r: Rotina) {
    if (!confirm(`Excluir a rotina "${r.titulo}"?`)) return;
    await apagarRotina(r.id);
  }

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (loadingPerfis && !isMaster) return <div className="text-sm text-gray-500 py-12 text-center">Carregando permissões…</div>;
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      {/* Abas */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-800">
        {([["sistema", "Avisos do sistema"], ["rotinas", "Rotinas"]] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setTab(v)}
            className={`px-4 py-2 text-sm font-semibold -mb-px border-b-2 ${tab === v ? "border-indigo-500 text-indigo-600 dark:text-indigo-300" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>{l}</button>
        ))}
      </div>

      {tab === "sistema" ? (
        <AvisosSistemaTab rid={rid} pessoas={pessoas} modulosAtivos={modulosAtivos} meId={me?.id || ""} podeGerenciar={podeGerenciar} />
      ) : (
      <>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Lembretes recorrentes que aparecem na Central de Avisos dos responsáveis no dia devido.
        </p>
        {podeGerenciar && <Button onClick={() => setEditing("new")}>+ Nova rotina</Button>}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Carregando…</div>
      ) : rotinas.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center">
          <div className="text-4xl mb-3">🔁</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhuma rotina ainda</p>
          {podeGerenciar && <p className="text-sm text-gray-500 mt-1">Crie a primeira em "+ Nova rotina".</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {rotinas.map(r => {
            const prox = proximaData(r.recorrencia, hoje);
            const nomes = r.responsaveis.map(id => r.responsaveisNomes?.[id] || pessoaNome[id] || "?").join(", ");
            return (
              <div key={r.id} className={`rounded-xl border p-4 ${r.ativo ? "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900" : "border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40 opacity-70"}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-gray-900 dark:text-gray-100">{r.titulo}</h3>
                      {!r.ativo && <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">pausada</span>}
                    </div>
                    {r.descricao && <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{r.descricao}</p>}
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>🔁 {recorrenciaLabel(r.recorrencia)}</span>
                      {prox && <span>📅 próxima: {prox.split("-").reverse().join("/")}</span>}
                      {moduloLabel(r.moduloAlvo) && (
                        <span>➡️ {moduloLabel(r.moduloAlvo)}{subDestinoLabel(r.moduloAlvo, r.subAlvo) ? ` › ${subDestinoLabel(r.moduloAlvo, r.subAlvo)}` : ""}</span>
                      )}
                      <span>👤 {nomes}</span>
                    </div>
                  </div>
                  {podeGerenciar && (
                    <div className="flex gap-1 flex-wrap">
                      <Button size="sm" variant="secondary" onClick={() => toggleAtivo(r)}>{r.ativo ? "Pausar" : "Reativar"}</Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>Editar</Button>
                      <Button size="sm" variant="danger" onClick={() => excluir(r)}>×</Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && me && (
        <RotinaModal
          rid={rid}
          rotina={editing === "new" ? null : editing}
          pessoas={pessoas}
          modulosAtivos={modulosAtivos}
          meId={me.id}
          meNome={me.nome}
          onClose={() => setEditing(null)}
        />
      )}
      </>
      )}
    </div>
  );
}
