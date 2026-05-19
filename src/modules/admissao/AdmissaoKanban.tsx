// ════════════════════════════════════════════════════════════════════════════
//  Sub-tab "Kanban" — visualização de fluxo das admissões.
//  Implementação inicial: colunas default + drag-drop básico nativo (HTML5).
//  Próximas iterações: colunas customizáveis pela aba Config + regras
//  automáticas adicionais.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import {
  ADMISSAO_STATUS_LABEL,
  MOTIVO_CANCELAMENTO_LABEL,
  type Admissao,
  type Cargo,
  type KanbanColuna,
  type Restaurant,
} from "../../core/types";
import {
  excluirAdmissaoDefinitivamente,
  getKanbanColunas,
  moverColunaKanban,
  statusEfetivo,
} from "../../core/admissao/admissaoHelpers";

function fmtDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

type Props = {
  rid: string;
  activeRestaurant: Restaurant;
};

// Resolve a coluna que cada admissão ocupa: override manual prevalece sobre
// statusAuto. statusAuto pode ser string (1 status) ou string[] (vários).
function colunaCapturaStatus(col: KanbanColuna, st: string): boolean {
  if (!col.statusAuto) return false;
  if (Array.isArray(col.statusAuto)) return col.statusAuto.includes(st as never);
  return col.statusAuto === st;
}

function colunaDaAdmissao(adm: Admissao, colunas: KanbanColuna[]): string | null {
  if (adm.kanbanColunaId) {
    const c = colunas.find((c) => c.id === adm.kanbanColunaId);
    if (c) return c.id;
  }
  const st = statusEfetivo(adm);
  const c = colunas.find((c) => colunaCapturaStatus(c, st));
  return c?.id || null;
}

export function AdmissaoKanban({ rid, activeRestaurant }: Props) {
  const { pessoa: me } = useAuth();
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

  async function excluirCard(adm: Admissao) {
    if (!me?.isMaster) return;
    const ok = confirm(
      `EXCLUSÃO DEFINITIVA\n\n` +
      `Você vai apagar pra sempre o card da admissão de ${adm.candidato.nome} ` +
      `(CPF ${adm.candidato.cpf}). Essa ação não pode ser desfeita.\n\n` +
      `Confirma?`,
    );
    if (!ok) return;
    try {
      await excluirAdmissaoDefinitivamente(adm.id);
    } catch (e) {
      alert("Erro ao excluir: " + (e instanceof Error ? e.message : "?"));
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
                      {/* Cancelada/Expirada: badges cumulativas dos motivos + data + autor */}
                      {(a.status === "cancelada" || a.status === "expirada") && (
                        <div className="mt-1.5 pt-1.5 border-t border-rose-100 dark:border-rose-900/40 space-y-1">
                          <div className="flex flex-wrap gap-1">
                            {(a.motivosCancelamento || []).map((m) => (
                              <span
                                key={m}
                                className="inline-flex items-center text-[9px] px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-semibold"
                              >
                                {MOTIVO_CANCELAMENTO_LABEL[m]}
                              </span>
                            ))}
                            {/* Fallback pra cards antigos sem motivosCancelamento[] */}
                            {a.status === "cancelada" && !a.motivosCancelamento?.length && (
                              <span className="inline-flex items-center text-[9px] px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-semibold">
                                Cancelado pela empresa
                              </span>
                            )}
                            {a.status === "expirada" && !a.motivosCancelamento?.length && (
                              <span className="inline-flex items-center text-[9px] px-1.5 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold">
                                Expirado sem resposta
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-gray-500 dark:text-gray-400">
                            {a.canceladoEm
                              ? <>em {fmtDataHora(a.canceladoEm)} {a.canceladoPor?.nome ? `· ${a.canceladoPor.nome}` : ""}</>
                              : a.expiraEm
                              ? <>expirou em {fmtDataHora(a.expiraEm)}</>
                              : null}
                          </div>
                          {a.motivoCancelamento && (
                            <div className="text-[10px] text-gray-500 dark:text-gray-400 italic">
                              "{a.motivoCancelamento}"
                            </div>
                          )}
                        </div>
                      )}
                      {/* Exclusão definitiva: SÓ master, SÓ em cards cancelados ou expirados */}
                      {me?.isMaster && (a.status === "cancelada" || a.status === "expirada") && (
                        <button
                          type="button"
                          onClick={() => excluirCard(a)}
                          className="block mt-1 text-[10px] text-rose-600 dark:text-rose-400 hover:underline"
                          title="Apaga o card pra sempre (irreversível, só master)"
                        >
                          🗑️ excluir definitivamente
                        </button>
                      )}
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
