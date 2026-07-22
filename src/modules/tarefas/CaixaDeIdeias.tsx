// Caixa de Ideias — vitrine do Banco de Ideias DENTRO do Gestor de Tarefas.
// É o backlog pessoal: coisas que quero fazer mas ainda não viraram tarefa
// (sem prazo, sem responsável). Junta as ideias de TODAS as empresas do
// usuário (chip identificando cada uma) e filtra entre Minhas / De outros.
// Privadas seguem a mesma regra do Banco (só o dono e o master veem).
import { useEffect, useMemo, useState } from "react";
import type { Ideia, IdeiaStatus } from "../../core/types";
import { ouvirIdeiasVisiveis, backfillVisibilidade } from "../ideias/ideiasData";
import { IdeiaModal } from "../ideias/IdeiaModal";

// Status que ainda são "rascunho/backlog" (não puxadas nem descartadas).
const ABERTAS: IdeiaStatus[] = ["aberta", "em_discussao", "gerada_reuniao", "em_pauta", "discutida"];

// ── Faixa da Caixa de Ideias — vai FIXA logo abaixo do calendário (aba Minhas).
// Caixa amarela "acesa" (glow de lâmpada), largura cheia Seg→Dom, com as ideias
// como cards fluindo lado a lado e quebrando pra linha de baixo.
export function CaixaIdeiasFaixa({ rids, ridAtivo, meId, isMaster, restaurants, podePrivadas, onVerTodas, onVirarTarefa }: {
  rids: string[];
  ridAtivo: string;
  meId: string;
  isMaster: boolean;
  restaurants: { id: string; nome: string }[];
  podePrivadas: boolean;
  onVerTodas: () => void;
  onVirarTarefa: (ideia: Ideia) => void;
}) {
  const [ideias, setIdeias] = useState<Ideia[]>([]);
  const [editing, setEditing] = useState<Ideia | "new" | null>(null);
  const nomeDe = useMemo(() => { const m: Record<string, string> = {}; restaurants.forEach(r => { m[r.id] = r.nome; }); return m; }, [restaurants]);

  useEffect(() => {
    if (!meId || !rids.length) { setIdeias([]); return; }
    return ouvirIdeiasVisiveis(rids, meId, isMaster, setIdeias);
  }, [rids.join(","), meId, isMaster]); // eslint-disable-line react-hooks/exhaustive-deps

  // Minhas ideias em aberto (o backlog pessoal). As mais recentes primeiro.
  const minhas = useMemo(() => ideias
    .filter(i => i.criadoPor === meId && ABERTAS.includes(i.status))
    .sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || "")), [ideias, meId]);

  const multiEmpresa = rids.length > 1;
  const ridParaNova = ridAtivo || rids[0] || "";

  return (
    <div className="mt-3 rounded-2xl border border-amber-200/80 dark:border-amber-800/50 bg-amber-50/80 dark:bg-amber-900/10 p-3 shadow-[0_0_35px_-8px_rgba(251,191,36,0.55)] dark:shadow-[0_0_35px_-10px_rgba(251,191,36,0.35)]">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-sm font-bold text-amber-900 dark:text-amber-200">💡 Caixa de ideias</span>
        <span className="text-[11px] text-amber-700/70 dark:text-amber-300/60">rascunhos do que fazer — sem prazo nem responsável</span>
        <span className="flex-1" />
        {ridParaNova && <button type="button" onClick={() => setEditing("new")} className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white">+ Nova ideia</button>}
        <button type="button" onClick={onVerTodas} className="text-xs font-medium px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/20">Ver todas →</button>
      </div>

      {minhas.length === 0 ? (
        <button type="button" onClick={() => ridParaNova && setEditing("new")} className="w-full rounded-xl border border-dashed border-amber-300 dark:border-amber-800 py-6 text-center text-[13px] text-amber-700/80 dark:text-amber-300/70 hover:bg-amber-100/50 dark:hover:bg-amber-900/10">
          Nenhuma ideia ainda — capture aqui o que quiser fazer. {ridParaNova ? "Clique pra adicionar." : ""}
        </button>
      ) : (
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
          {minhas.map(i => (
            <div key={i.id} className="group relative rounded-lg border border-amber-200/70 dark:border-amber-900/40 bg-white dark:bg-gray-900 p-2 hover:border-amber-400 dark:hover:border-amber-600 transition-colors">
              <button type="button" onClick={() => setEditing(i)} className="w-full text-left">
                <div className="text-[12px] font-medium text-gray-900 dark:text-gray-100 line-clamp-2 leading-snug">{i.visibilidade === "privada" && <span title="privada" className="text-indigo-600 dark:text-indigo-400">🔒 </span>}{i.titulo}</div>
                {(multiEmpresa || i.categoria) && (
                  <div className="flex items-center gap-1 flex-wrap mt-1">
                    {multiEmpresa && <span className="text-[9px] px-1 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 truncate max-w-full">🏢 {nomeDe[i.restaurantId] || "—"}</span>}
                    {i.categoria && <span className="text-[9px] px-1 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">{i.categoria}</span>}
                  </div>
                )}
              </button>
              <button type="button" onClick={() => onVirarTarefa(i)} title="Virar tarefa" className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded bg-indigo-600 text-white">→ tarefa</button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <IdeiaModal ideia={editing === "new" ? null : editing} restaurantId={editing === "new" ? ridParaNova : editing.restaurantId} podePrivadas={podePrivadas} empresas={restaurants.filter(r => rids.includes(r.id))} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

export function CaixaDeIdeias({ rids, ridAtivo, meId, isMaster, restaurants, podePrivadas, onVoltar, onVirarTarefa }: {
  rids: string[];
  ridAtivo: string;
  meId: string;
  isMaster: boolean;
  restaurants: { id: string; nome: string }[];
  podePrivadas: boolean;
  onVoltar: () => void;
  onVirarTarefa: (ideia: Ideia) => void;
}) {
  const [ideias, setIdeias] = useState<Ideia[]>([]);
  const [filtro, setFiltro] = useState<"minhas" | "outros" | "todas">("minhas");
  const [busca, setBusca] = useState("");
  const [mostrarConsumidas, setMostrarConsumidas] = useState(false);
  const [editing, setEditing] = useState<Ideia | "new" | null>(null);

  const nomeDe = useMemo(() => { const m: Record<string, string> = {}; restaurants.forEach(r => { m[r.id] = r.nome; }); return m; }, [restaurants]);

  useEffect(() => {
    if (!meId || !rids.length) { setIdeias([]); return; }
    return ouvirIdeiasVisiveis(rids, meId, isMaster, setIdeias);
  }, [rids.join(","), meId, isMaster]); // eslint-disable-line react-hooks/exhaustive-deps

  // Backfill 1x das legadas visíveis (só afeta as que a pessoa pode escrever).
  useEffect(() => {
    if (ideias.some(i => i.visibilidade == null)) void backfillVisibilidade(ideias.filter(i => i.visibilidade == null && i.criadoPor === meId));
  }, [ideias, meId]);

  const bn = busca.trim().toLowerCase();
  const lista = useMemo(() => ideias
    .filter(i => mostrarConsumidas || ABERTAS.includes(i.status))
    .filter(i => filtro === "todas" || (filtro === "minhas" ? i.criadoPor === meId : i.criadoPor !== meId))
    .filter(i => !bn || i.titulo.toLowerCase().includes(bn) || (i.descricao || "").toLowerCase().includes(bn))
    .sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || "")),
    [ideias, filtro, mostrarConsumidas, bn, meId]);

  const cont = useMemo(() => {
    const base = ideias.filter(i => ABERTAS.includes(i.status));
    return { minhas: base.filter(i => i.criadoPor === meId).length, outros: base.filter(i => i.criadoPor !== meId).length, todas: base.length };
  }, [ideias, meId]);

  const multiEmpresa = rids.length > 1;
  const ridParaNova = ridAtivo || rids[0] || "";

  return (
    <div>
      <button type="button" onClick={onVoltar} className="mb-2 text-[12px] font-medium text-indigo-600 dark:text-indigo-300 hover:underline">← Minhas tarefas</button>
      <div className="mb-3 flex items-baseline gap-2 flex-wrap">
        <h2 className="text-base sm:text-xl font-bold text-gray-900 dark:text-gray-100">💡 Caixa de ideias</h2>
        <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">rascunhos do que fazer — ainda sem tarefa, prazo ou responsável</span>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        {([["minhas", `🙋 Minhas · ${cont.minhas}`], ["outros", `👥 De outros · ${cont.outros}`], ["todas", `Todas · ${cont.todas}`]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)} className={`text-xs px-3 py-1.5 rounded-full border ${filtro === k ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium" : "border-gray-200 dark:border-gray-700 text-gray-500"}`}>{l}</button>
        ))}
        <div className="flex-1" />
        {ridParaNova && <button type="button" onClick={() => setEditing("new")} className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white">+ Nova ideia</button>}
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔍 Buscar…" className="flex-1 min-w-[180px] px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
        <label className="text-xs text-gray-500 flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={mostrarConsumidas} onChange={e => setMostrarConsumidas(e.target.checked)} /> mostrar puxadas/descartadas</label>
      </div>

      {lista.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">
          {filtro === "minhas" ? "Nenhuma ideia sua ainda. Jogue aqui o que quiser fazer — sem compromisso de prazo." : "Nada aqui."}
        </div>
      ) : (
        <div className="space-y-2">
          {lista.map(i => {
            const minha = i.criadoPor === meId;
            const consumida = !ABERTAS.includes(i.status);
            return (
              <div key={i.id} className={`rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 ${consumida ? "opacity-60" : ""}`}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{i.visibilidade === "privada" && <span title="privada" className="text-indigo-600 dark:text-indigo-400">🔒 </span>}{i.titulo}</div>
                    {i.descricao && <p className="text-[13px] text-gray-600 dark:text-gray-300 mt-0.5 whitespace-pre-wrap line-clamp-3">{i.descricao}</p>}
                    <div className="flex items-center gap-1.5 flex-wrap mt-1.5 text-[11px] text-gray-500">
                      {multiEmpresa && <span className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">🏢 {nomeDe[i.restaurantId] || "empresa"}</span>}
                      {i.categoria && <span className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">{i.categoria}</span>}
                      {!minha && i.criadoPorNome && <span>✍️ {i.criadoPorNome}</span>}
                      {consumida && <span className="text-amber-600">{i.status === "puxada_tarefa" ? "→ virou tarefa" : "descartada"}</span>}
                      {i.criadoEm && <span>· {new Date(i.criadoEm).toLocaleDateString("pt-BR")}</span>}
                    </div>
                  </div>
                </div>
                {!consumida && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-2 mt-2 border-t border-gray-100 dark:border-gray-800">
                    <button type="button" onClick={() => onVirarTarefa(i)} className="text-xs font-medium px-2.5 py-1 rounded-lg bg-indigo-600 text-white">→ Virar tarefa</button>
                    <button type="button" onClick={() => setEditing(i)} className="text-xs px-2 py-1 rounded-lg text-gray-400 hover:text-gray-700" title="Editar ideia">✎</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <IdeiaModal
          ideia={editing === "new" ? null : editing}
          restaurantId={editing === "new" ? ridParaNova : editing.restaurantId}
          podePrivadas={podePrivadas}
          empresas={restaurants.filter(r => rids.includes(r.id))}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
