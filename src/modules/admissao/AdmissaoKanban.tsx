// ════════════════════════════════════════════════════════════════════════════
//  Sub-tab "Kanban" — visualização de fluxo das admissões.
//  Implementação inicial: colunas default + drag-drop básico nativo (HTML5).
//  Próximas iterações: colunas customizáveis pela aba Config + regras
//  automáticas adicionais.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import {
  ADMISSAO_STATUS_LABEL,
  type Admissao,
  type Cargo,
  type KanbanColuna,
  type Restaurant,
} from "../../core/types";
import {
  getKanbanColunas,
  moverColunaKanban,
  statusEfetivo,
} from "../../core/admissao/admissaoHelpers";

type Props = {
  rid: string;
  activeRestaurant: Restaurant;
};

// Resolve a coluna que cada admissão ocupa: override manual prevalece sobre
// statusAuto.
function colunaDaAdmissao(adm: Admissao, colunas: KanbanColuna[]): string | null {
  if (adm.kanbanColunaId) {
    const c = colunas.find((c) => c.id === adm.kanbanColunaId);
    if (c) return c.id;
  }
  const st = statusEfetivo(adm);
  const c = colunas.find((c) => c.statusAuto === st);
  return c?.id || null;
}

export function AdmissaoKanban({ rid, activeRestaurant }: Props) {
  const [admissoes, setAdmissoes] = useState<Admissao[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(
      query(collection(db, "admissoes"), where("restaurantId", "==", rid)),
      (snap) => setAdmissoes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Admissao))),
    );
    const u2 = onSnapshot(
      query(collection(db, "cargos"), where("restaurantId", "==", rid)),
      (snap) => setCargos(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Cargo))),
    );
    return () => { u1(); u2(); };
  }, [rid]);

  const colunas = useMemo(
    () => [...getKanbanColunas(activeRestaurant)].sort((a, b) => a.ordem - b.ordem),
    [activeRestaurant],
  );

  const cargoPorId = useMemo(() => {
    const m = new Map<string, Cargo>();
    for (const c of cargos) m.set(c.id, c);
    return m;
  }, [cargos]);

  // Admissões por coluna. Aplica filtro: esconde admitidas/canceladas exceto
  // se estão na coluna final correspondente.
  const porColuna = useMemo(() => {
    const m = new Map<string, Admissao[]>();
    for (const c of colunas) m.set(c.id, []);
    for (const a of admissoes) {
      const colId = colunaDaAdmissao(a, colunas);
      if (!colId) continue;
      const arr = m.get(colId) || [];
      arr.push(a);
      m.set(colId, arr);
    }
    // Ordena cada coluna por data
    for (const [, arr] of m) {
      arr.sort((a, b) => b.iniciadoEm.localeCompare(a.iniciadoEm));
    }
    return m;
  }, [admissoes, colunas]);

  async function onDrop(colId: string) {
    if (!draggingId) return;
    try {
      await moverColunaKanban(draggingId, colId);
    } catch (e) {
      alert("Erro ao mover: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setDraggingId(null);
    }
  }

  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Arraste os cards entre colunas pra mover manualmente. Por default cada admissão cai na
        coluna correspondente ao status — clica em <strong>⚙️ Configurações</strong> pra editar
        as colunas.
      </p>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {colunas.map((col) => {
          const cards = porColuna.get(col.id) || [];
          return (
            <div
              key={col.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(col.id)}
              className="flex-shrink-0 w-72 bg-gray-50 dark:bg-gray-900/40 rounded-xl border border-gray-200 dark:border-gray-800 p-2"
            >
              <div className="flex items-center gap-2 mb-2 px-1">
                {col.cor && (
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: `#${col.cor}` }}
                  />
                )}
                <div className="font-semibold text-sm text-gray-800 dark:text-gray-100">
                  {col.nome}
                </div>
                <span className="ml-auto text-[11px] text-gray-500 dark:text-gray-400">
                  {cards.length}
                </span>
              </div>
              <div className="space-y-1.5 min-h-[80px]">
                {cards.map((a) => {
                  const cargo = cargoPorId.get(a.cargoId);
                  const st = statusEfetivo(a);
                  return (
                    <div
                      key={a.id}
                      draggable
                      onDragStart={() => setDraggingId(a.id)}
                      onDragEnd={() => setDraggingId(null)}
                      className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 cursor-move ${
                        draggingId === a.id ? "opacity-50" : ""
                      }`}
                    >
                      <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                        {a.candidato.nome}
                      </div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                        {cargo?.nome || "—"} · {ADMISSAO_STATUS_LABEL[st]}
                      </div>
                    </div>
                  );
                })}
                {cards.length === 0 && (
                  <div className="text-[10px] text-gray-400 italic text-center py-3">
                    — vazio —
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
