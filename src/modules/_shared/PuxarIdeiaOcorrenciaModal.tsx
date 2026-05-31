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

type IdeiaLite = {
  id: string;
  titulo: string;
  descricao?: string;
  categoria?: string;
  restaurantId: string;
  status: string;
};

type OcorrenciaLite = {
  id: string;
  titulo: string;
  descricao?: string;
  gravidade?: string;
  data?: string;
  restaurantId: string;
  status: string;
};

export type PuxarEscolha =
  | { tipo: "ideia"; id: string; titulo: string; descricao?: string }
  | { tipo: "ocorrencia"; id: string; titulo: string; descricao?: string };

type Props = {
  onClose: () => void;
  onEscolher: (item: PuxarEscolha) => void;
  // Se setado, filtra só os do restaurante. Se omitido, lista tudo.
  restaurantId?: string;
  // Título do modal. Default: "Puxar de Banco de Ideias / Ocorrências"
  titulo?: string;
};

export function PuxarIdeiaOcorrenciaModal({ onClose, onEscolher, restaurantId, titulo }: Props) {
  const [ideias, setIdeias] = useState<IdeiaLite[]>([]);
  const [ocorrencias, setOcorrencias] = useState<OcorrenciaLite[]>([]);
  const [search, setSearch] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<"todos" | "ideia" | "ocorrencia">("todos");

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "ideias"), snap => {
      setIdeias(snap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as IdeiaLite));
    });
    const u2 = onSnapshot(collection(db, "ocorrencias"), snap => {
      setOcorrencias(snap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as OcorrenciaLite));
    });
    return () => { u1(); u2(); };
  }, []);

  const filtroRest = (rid: string) => !restaurantId || rid === restaurantId;
  const filtroBusca = (txt: string) => !search.trim() || txt.toLowerCase().includes(search.toLowerCase());

  const ideiasAtivas = ideias.filter(i =>
    filtroRest(i.restaurantId) &&
    i.status !== "puxada_tarefa" &&
    i.status !== "descartada"
  );
  const ocorrenciasAtivas = ocorrencias.filter(o =>
    filtroRest(o.restaurantId) &&
    o.status !== "puxada_tarefa" &&
    o.status !== "arquivada" &&
    o.status !== "resolvida"
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-xl p-5 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold mb-3 text-gray-900 dark:text-gray-100">
          {titulo || "Puxar de Banco de Ideias / Ocorrências"}
        </h3>
        <div className="flex gap-2 mb-3">
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
                {i.categoria && <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mt-0.5">{i.categoria}</div>}
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
                {o.gravidade && <div className="text-[10px] uppercase tracking-wider text-rose-600 dark:text-rose-400 mt-0.5">{o.gravidade}{o.data && ` · ${o.data}`}</div>}
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
