// Governança de IA — diretrizes do que a IA pode/não pode responder (por empresa,
// replicáveis pra outras), registro jurídico das interações (auditoria) e alertas
// de uso fora do escopo (LGPD). Alertas ao vivo saem na Central de Avisos
// (fonte iaInteracoes em useAvisos, gate iaGovernanca.receberAlertas).

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, where, doc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import { fmtBR } from "../../core/utils/date";

type IaInteracao = {
  id: string; restaurantId: string; moduleLabel?: string; canal?: string;
  pessoaId?: string; pessoaNome?: string; pergunta?: string; resposta?: string;
  foraDeEscopo?: boolean; motivo?: string; createdAt?: string;
};

const DIRETRIZES_MODELO = `A IA só pode responder sobre os processos internos documentados na plataforma (gestão do restaurante: operação, cozinha, salão, DP, financeiro, etc.).

NÃO pode:
- Dar orientação jurídica, médica ou contábil que não esteja documentada.
- Tratar de assuntos pessoais dos colaboradores ou dados de terceiros.
- Responder pedidos ofensivos, discriminatórios ou fora do trabalho.
- Inventar informação que não esteja na wiki.

Em caso de dúvida fora do escopo, recusar educadamente e orientar a procurar a liderança/DP.`;

export function IaGovernancaPage() {
  const { pessoa } = useAuth();
  const { rid } = useParams<{ rid: string }>();
  const { restaurants } = useRestaurant();
  const { can, loading } = useCanAcao(rid || "");
  const podeConfig = can("iaGovernanca", "configurar");
  const podeVerReg = can("iaGovernanca", "verRegistros");
  const podeVer = podeConfig || podeVerReg || can("iaGovernanca", "receberAlertas");

  const [aba, setAba] = useState<"diretrizes" | "registros">("diretrizes");
  const [diretrizes, setDiretrizes] = useState("");
  const [carregou, setCarregou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [replicar, setReplicar] = useState(false);
  const [interacoes, setInteracoes] = useState<IaInteracao[]>([]);
  const [filtro, setFiltro] = useState<"todas" | "fora">("todas");
  const [aberta, setAberta] = useState<string | null>(null);

  useEffect(() => {
    if (!rid) return;
    const u = onSnapshot(doc(db, "iaConfig", rid), snap => {
      setDiretrizes((snap.data() as { diretrizes?: string } | undefined)?.diretrizes || "");
      setCarregou(true);
    });
    return () => u();
  }, [rid]);

  useEffect(() => {
    if (!rid || !podeVerReg) return;
    const u = onSnapshot(query(collection(db, "iaInteracoes"), where("restaurantId", "==", rid)),
      snap => setInteracoes(snap.docs.map(d => ({ id: d.id, ...d.data() }) as IaInteracao).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))));
    return () => u();
  }, [rid, podeVerReg]);

  if (!pessoa) return null;
  if (loading) return <div className="max-w-4xl mx-auto p-6 text-sm text-gray-400">Carregando…</div>;
  if (!podeVer) return <div className="max-w-4xl mx-auto p-8 text-center text-gray-500">Você não tem permissão para acessar a Governança de IA.</div>;

  async function salvar() {
    if (!rid) return;
    setSalvando(true);
    try {
      await setDoc(doc(db, "iaConfig", rid), sanitizeForFirestore({ restaurantId: rid, diretrizes: diretrizes.trim(), atualizadoEm: new Date().toISOString(), atualizadoPor: pessoa!.id }), { merge: true });
    } catch (e) { alert("Erro ao salvar: " + (e instanceof Error ? e.message : "?")); }
    finally { setSalvando(false); }
  }

  const registrosVis = interacoes.filter(i => filtro === "todas" || i.foraDeEscopo);
  const nFora = interacoes.filter(i => i.foraDeEscopo).length;

  const tabBtn = (val: "diretrizes" | "registros", label: string, badge?: number) => (
    <button type="button" onClick={() => setAba(val)}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${aba === val ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>
      {label}{badge ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{badge}</span> : null}
    </button>
  );

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">🛡️ Governança de IA</h1>
      </div>
      <p className="text-xs text-gray-500 mb-4">Defina o que a IA pode responder, acompanhe as interações e receba alertas de uso fora do escopo (LGPD).</p>

      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 mb-4">
        {(podeConfig || podeVer) && tabBtn("diretrizes", "📋 Diretrizes")}
        {podeVerReg && tabBtn("registros", "🗂️ Registros", nFora)}
      </div>

      {aba === "diretrizes" ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">O que a IA pode e não pode responder</div>
              {podeConfig && diretrizes.trim() === "" && <button type="button" onClick={() => setDiretrizes(DIRETRIZES_MODELO)} className="text-xs text-indigo-600 hover:underline">Usar modelo sugerido</button>}
            </div>
            <textarea value={diretrizes} onChange={e => setDiretrizes(e.target.value)} disabled={!podeConfig} rows={14}
              placeholder={podeConfig ? "Escreva as diretrizes da IA para esta empresa…" : "Sem diretrizes definidas."}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 leading-relaxed disabled:opacity-70" />
            <p className="text-[11px] text-gray-400 mt-1.5">Essas diretrizes entram como instrução da IA em toda consulta desta empresa. Se a pergunta violá-las, a IA recusa e o caso vira um registro/alerta.</p>
            {podeConfig && (
              <div className="flex gap-2 justify-between mt-3 flex-wrap">
                <Button variant="secondary" onClick={() => setReplicar(true)} disabled={!carregou}>📑 Copiar para outras empresas</Button>
                <Button onClick={salvar} disabled={salvando || !carregou}>{salvando ? "Salvando…" : "Salvar diretrizes"}</Button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm text-gray-500">{interacoes.length} interaç{interacoes.length === 1 ? "ão" : "ões"} registrada{interacoes.length === 1 ? "" : "s"}{nFora > 0 ? ` · ${nFora} fora do escopo` : ""}</div>
            <div className="flex gap-1.5 ml-auto">
              <Chip active={filtro === "todas"} onClick={() => setFiltro("todas")}>Todas</Chip>
              <Chip active={filtro === "fora"} onClick={() => setFiltro("fora")}>⚠️ Fora do escopo</Chip>
            </div>
          </div>
          {registrosVis.length === 0 ? (
            <div className="text-center py-10 text-gray-500 dark:text-gray-400 text-sm">Nenhum registro {filtro === "fora" ? "fora do escopo " : ""}ainda.</div>
          ) : (
            <div className="space-y-2">
              {registrosVis.map(i => (
                <div key={i.id} className={`rounded-xl border p-3 ${i.foraDeEscopo ? "border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-900/10" : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"}`}>
                  <button type="button" onClick={() => setAberta(aberta === i.id ? null : i.id)} className="w-full text-left">
                    <div className="flex items-center gap-2 flex-wrap">
                      {i.foraDeEscopo && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">⚠️ Fora do escopo</span>}
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{i.pessoaNome || "—"}</span>
                      <span className="text-[11px] text-gray-400">{i.moduleLabel || "IA"} · {fmtBR((i.createdAt || "").slice(0, 10))}</span>
                    </div>
                    <div className="text-sm text-gray-700 dark:text-gray-300 mt-1 line-clamp-2">“{i.pergunta}”</div>
                    {i.foraDeEscopo && i.motivo && <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">Motivo: {i.motivo}</div>}
                  </button>
                  {aberta === i.id && (
                    <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                      <div className="text-[11px] font-semibold text-gray-500 mb-1">Resposta da IA</div>
                      <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{i.resposta || "—"}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {replicar && (
        <ReplicarModal diretrizes={diretrizes} restaurantes={restaurants.filter(r => r.id !== rid).map(r => ({ id: r.id, nome: r.nome }))} pessoaId={pessoa.id} onClose={() => setReplicar(false)} />
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${active ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>{children}</button>
  );
}

// Replicar as mesmas diretrizes pra outras empresas (marca as que quer copiar).
function ReplicarModal({ diretrizes, restaurantes, pessoaId, onClose }: {
  diretrizes: string; restaurantes: { id: string; nome: string }[]; pessoaId: string; onClose: () => void;
}) {
  const [sel, setSel] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const toggle = (id: string) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  async function copiar() {
    if (sel.length === 0) return;
    setSalvando(true);
    try {
      const now = new Date().toISOString();
      await Promise.all(sel.map(id => setDoc(doc(db, "iaConfig", id), sanitizeForFirestore({ restaurantId: id, diretrizes: diretrizes.trim(), atualizadoEm: now, atualizadoPor: pessoaId }), { merge: true })));
      alert(`Diretrizes copiadas para ${sel.length} empresa(s).`);
      onClose();
    } catch (e) { alert("Erro ao copiar: " + (e instanceof Error ? e.message : "?")); }
    finally { setSalvando(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md p-5 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">📑 Copiar diretrizes</h2>
        <p className="text-xs text-gray-500 mt-1 mb-3">As diretrizes atuais vão substituir as das empresas marcadas.</p>
        {restaurantes.length === 0 ? (
          <div className="text-sm text-gray-500 py-4 text-center">Você não tem outras empresas pra copiar.</div>
        ) : (
          <div className="space-y-1.5 mb-4">
            {restaurantes.map(r => (
              <label key={r.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
                <input type="checkbox" checked={sel.includes(r.id)} onChange={() => toggle(r.id)} />{r.nome}
              </label>
            ))}
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={copiar} disabled={salvando || sel.length === 0}>{salvando ? "Copiando…" : `Copiar para ${sel.length || ""}`}</Button>
        </div>
      </div>
    </div>
  );
}
