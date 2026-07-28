// Seletor reutilizável de Ideia/Ocorrência abertas pra "puxar" pra outro
// módulo (Tarefas, Reuniões/Pauta).
//
// O caller decide o que fazer com a escolha — esse componente só lista
// itens ABERTOS (não puxados, não descartados, não resolvidos/arquivados)
// e chama `onEscolher` com o objeto bruto.

import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import { fmtBR } from "../../core/utils/date";

type IdeiaLite = {
  id: string;
  titulo: string;
  descricao?: string;
  categoria?: string;
  restaurantId: string;
  status: string;
  criadoPor?: string;
  criadoPorNome?: string;
};

type OcorrenciaLite = {
  id: string;
  titulo: string;
  descricao?: string;
  gravidade?: string;
  data?: string;
  restaurantId: string;
  status: string;
  criadaPor?: string;
  criadaPorNome?: string;
};

export type PuxarEscolha =
  | { tipo: "ideia"; id: string; titulo: string; descricao?: string }
  | { tipo: "ocorrencia"; id: string; titulo: string; descricao?: string };

type Props = {
  onClose: () => void;
  onEscolher: (item: PuxarEscolha) => void;
  // Se setado, filtra só os do restaurante (escopo fixo). Se omitido, lista tudo.
  restaurantId?: string;
  // Título do modal. Default: "Puxar de Banco de Ideias / Ocorrências"
  titulo?: string;
  // Se setado, habilita toggle "Minhas / Todas" filtrando por criadoPor.
  pessoaIdAtual?: string;
  // Se setado (e restaurantId omitido), mostra chips pra escolher de qual
  // empresa puxar — usado no Gestor de Tarefas, que é independente de empresa.
  restaurantes?: { id: string; nome: string }[];
};

export function PuxarIdeiaOcorrenciaModal({ onClose, onEscolher, restaurantId, titulo, pessoaIdAtual, restaurantes }: Props) {
  const [ideias, setIdeias] = useState<IdeiaLite[]>([]);
  const [ocorrencias, setOcorrencias] = useState<OcorrenciaLite[]>([]);
  const [search, setSearch] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<"todos" | "ideia" | "ocorrencia">("todos");
  const [escopo, setEscopo] = useState<"todas" | "minhas">("todas");
  const [restFiltro, setRestFiltro] = useState<string>("todas");

  // Chips de empresa só quando há mais de uma e não há escopo fixo.
  const mostrarChipsEmpresa = !restaurantId && (restaurantes?.length || 0) > 1;
  const nomeEmpresa = (rid: string) => restaurantes?.find(r => r.id === rid)?.nome || "";

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "ideias"), snap => {
      setIdeias(snap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as IdeiaLite));
    });
    const u2 = onSnapshot(collection(db, "ocorrencias"), snap => {
      setOcorrencias(snap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as OcorrenciaLite));
    });
    return () => { u1(); u2(); };
  }, []);

  const filtroRest = (rid: string) => {
    if (restaurantId) return rid === restaurantId;        // escopo fixo (legado)
    if (restFiltro !== "todas") return rid === restFiltro; // chip selecionado
    return true;                                           // todas
  };
  const filtroBusca = (txt: string) => !search.trim() || txt.toLowerCase().includes(search.toLowerCase());
  const ehMinha = (criadoPor?: string) => escopo === "todas" || (!!pessoaIdAtual && criadoPor === pessoaIdAtual);

  const ideiasAtivas = ideias.filter(i =>
    filtroRest(i.restaurantId) &&
    i.status !== "puxada_tarefa" &&
    i.status !== "descartada" &&
    ehMinha(i.criadoPor)
  );
  const ocorrenciasAtivas = ocorrencias.filter(o =>
    filtroRest(o.restaurantId) &&
    o.status !== "puxada_tarefa" &&
    o.status !== "arquivada" &&
    o.status !== "resolvida" &&
    ehMinha(o.criadaPor)
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-[210] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-xl p-5 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold mb-3 text-gray-900 dark:text-gray-100">
          {titulo || "Puxar de Banco de Ideias / Ocorrências"}
        </h3>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            placeholder="🔍 Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value as "todos" | "ideia" | "ocorrencia")}
            className="w-32 px-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          >
            <option value="todos">Todos</option>
            <option value="ideia">💡 Ideias</option>
            <option value="ocorrencia">🚨 Ocorrências</option>
          </select>
        </div>
        {pessoaIdAtual && (
          <div className="inline-flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 mb-3">
            {(["todas", "minhas"] as const).map(e => (
              <button
                key={e}
                type="button"
                onClick={() => setEscopo(e)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  escopo === e
                    ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm"
                    : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                }`}
              >
                {e === "todas" ? "Todas" : "Só minhas"}
              </button>
            ))}
          </div>
        )}
        {mostrarChipsEmpresa && (
          <div className="mb-3">
            <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">De qual empresa?</div>
            <div className="flex flex-wrap gap-1.5">
              {[{ id: "todas", nome: "Todas" }, ...(restaurantes || [])].map(r => {
                const on = restFiltro === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRestFiltro(r.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full border ${on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}
                  >
                    {r.nome}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto space-y-2">
          {(filtroTipo === "todos" || filtroTipo === "ideia") && ideiasAtivas
            .filter(i => filtroBusca(i.titulo + " " + (i.descricao || "")))
            .map(i => (
              <button
                key={"i-" + i.id}
                onClick={() => onEscolher({ tipo: "ideia", id: i.id, titulo: i.titulo, descricao: i.descricao })}
                className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
              >
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">💡 {i.titulo}</div>
                <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                  {mostrarChipsEmpresa && nomeEmpresa(i.restaurantId) && <span className="text-indigo-600 dark:text-indigo-400">🏢 {nomeEmpresa(i.restaurantId)}</span>}
                  {i.categoria && <span>{i.categoria}</span>}
                </div>
                {i.descricao && <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">{i.descricao}</div>}
              </button>
            ))}
          {(filtroTipo === "todos" || filtroTipo === "ocorrencia") && ocorrenciasAtivas
            .filter(o => filtroBusca(o.titulo + " " + (o.descricao || "")))
            .map(o => (
              <button
                key={"o-" + o.id}
                onClick={() => onEscolher({ tipo: "ocorrencia", id: o.id, titulo: o.titulo, descricao: o.descricao })}
                className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
              >
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">🚨 {o.titulo}</div>
                <div className="text-[10px] uppercase tracking-wider mt-0.5 flex items-center gap-1.5 flex-wrap">
                  {mostrarChipsEmpresa && nomeEmpresa(o.restaurantId) && <span className="text-indigo-600 dark:text-indigo-400">🏢 {nomeEmpresa(o.restaurantId)}</span>}
                  {o.gravidade && <span className="text-rose-600 dark:text-rose-400">{o.gravidade}{o.data && ` · ${fmtBR(o.data)}`}</span>}
                </div>
                {o.descricao && <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">{o.descricao}</div>}
              </button>
            ))}
          {ideiasAtivas.length === 0 && ocorrenciasAtivas.length === 0 && (
            <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
              Nenhuma ideia ou ocorrência aberta pra puxar.
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800 mt-3">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </div>
  );
}
