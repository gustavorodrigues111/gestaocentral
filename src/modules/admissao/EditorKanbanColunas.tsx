// ════════════════════════════════════════════════════════════════════════════
//  Editor das colunas do Kanban da Admissão. Permite adicionar, editar,
//  reordenar e remover colunas, além de definir a regra automática
//  (statusAuto) — quando admissão entra em determinado status, o card cai
//  automaticamente naquela coluna.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import {
  ADMISSAO_STATUS_LABEL,
  type AdmissaoStatus,
  type KanbanColuna,
  type Restaurant,
} from "../../core/types";
import { KANBAN_COLUNAS_DEFAULT } from "../../core/admissao/formTemplate";
import {
  getKanbanColunas,
  salvarConfigAdmissao,
} from "../../core/admissao/admissaoHelpers";

type Props = {
  rid: string;
  activeRestaurant: Restaurant;
};

const STATUS_OPCOES: AdmissaoStatus[] = [
  "formulario_enviado",
  "formulario_preenchido",
  "documentos_recebidos",
  "admitido",
  "cancelada",
  "expirada",
];

const CORES_SUGERIDAS = [
  "94a3b8", // cinza
  "f59e0b", // amarelo
  "10b981", // verde
  "0ea5e9", // azul
  "6366f1", // índigo
  "ec4899", // rosa
  "f43f5e", // vermelho
  "8b5cf6", // roxo
];

function uid(): string {
  return `col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function EditorKanbanColunas({ rid, activeRestaurant }: Props) {
  // Estado local pra editar; só persiste no Firestore quando clica em "Salvar"
  const [colunas, setColunas] = useState<KanbanColuna[]>(
    [...getKanbanColunas(activeRestaurant)].sort((a, b) => a.ordem - b.ordem),
  );
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");

  function atualizarColuna(id: string, patch: Partial<KanbanColuna>) {
    setColunas((cur) => cur.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function moverColuna(id: string, delta: number) {
    setColunas((cur) => {
      const idx = cur.findIndex((c) => c.id === id);
      if (idx === -1) return cur;
      const novoIdx = idx + delta;
      if (novoIdx < 0 || novoIdx >= cur.length) return cur;
      const arr = [...cur];
      const [item] = arr.splice(idx, 1);
      arr.splice(novoIdx, 0, item);
      return arr.map((c, i) => ({ ...c, ordem: i + 1 }));
    });
  }

  function removerColuna(id: string) {
    if (!confirm("Remover essa coluna? Cards que estavam nela voltam à coluna automática do status.")) return;
    setColunas((cur) =>
      cur.filter((c) => c.id !== id).map((c, i) => ({ ...c, ordem: i + 1 })),
    );
  }

  function adicionarColuna() {
    setColunas((cur) => [
      ...cur,
      {
        id: uid(),
        nome: "Nova coluna",
        ordem: cur.length + 1,
        cor: CORES_SUGERIDAS[cur.length % CORES_SUGERIDAS.length],
      },
    ]);
  }

  function restaurarDefault() {
    if (!confirm("Restaurar as 4 colunas padrão? Você perde as personalizações.")) return;
    setColunas([...KANBAN_COLUNAS_DEFAULT]);
  }

  async function salvar() {
    setMsg("");
    // Validações
    if (colunas.length === 0) {
      setMsg("❌ Pelo menos 1 coluna é obrigatória.");
      return;
    }
    for (const c of colunas) {
      if (!c.nome.trim()) {
        setMsg("❌ Toda coluna precisa ter nome.");
        return;
      }
    }
    // Avisa se algum statusAuto duplicado (não bloqueia — mas avisa)
    const statusUsados = colunas
      .map((c) => c.statusAuto)
      .filter((s): s is AdmissaoStatus => !!s);
    const duplicados = statusUsados.filter((s, i) => statusUsados.indexOf(s) !== i);
    if (duplicados.length > 0) {
      const ok = confirm(
        `Atenção: status duplicado em regra automática (${duplicados.join(", ")}). Só a primeira coluna que tem o status vai receber o card. Continuar?`,
      );
      if (!ok) return;
    }

    setSalvando(true);
    try {
      // Normaliza ordem e limpa nomes
      const normalized = colunas.map((c, i) => ({
        ...c,
        ordem: i + 1,
        nome: c.nome.trim(),
      }));
      await salvarConfigAdmissao(rid, { admissaoKanbanColunas: normalized });
      setColunas(normalized);
      setMsg("✓ Colunas salvas. As mudanças refletem no Kanban.");
    } catch (e) {
      setMsg("❌ " + (e instanceof Error ? e.message : "Erro"));
    } finally {
      setSalvando(false);
    }
  }

  // Detecta status sem coluna pra dar aviso (cards vão sumir do Kanban)
  const statusSemColuna = STATUS_OPCOES.filter(
    (s) => !colunas.some((c) => c.statusAuto === s),
  );

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="font-bold text-sm text-gray-900 dark:text-gray-100">
            🗂️ Colunas do Kanban
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Configure as colunas e qual status faz o card migrar automaticamente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={restaurarDefault}
            className="text-[11px] text-gray-500 dark:text-gray-400 hover:underline"
          >
            ↻ restaurar default
          </button>
          <Button size="sm" onClick={adicionarColuna}>
            + adicionar coluna
          </Button>
        </div>
      </div>

      {statusSemColuna.length > 0 && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-2 text-[11px] text-amber-800 dark:text-amber-300">
          ⚠ Sem coluna com regra automática pra:{" "}
          <strong>{statusSemColuna.map((s) => ADMISSAO_STATUS_LABEL[s]).join(", ")}</strong>.
          Cards nesses status não aparecem no Kanban a não ser que sejam arrastados manualmente.
        </div>
      )}

      <div className="space-y-2">
        {colunas.map((col, idx) => (
          <ColunaRow
            key={col.id}
            coluna={col}
            podeSubir={idx > 0}
            podeDescer={idx < colunas.length - 1}
            onUpdate={(patch) => atualizarColuna(col.id, patch)}
            onMover={(delta) => moverColuna(col.id, delta)}
            onRemover={() => removerColuna(col.id)}
          />
        ))}
        {colunas.length === 0 && (
          <div className="text-center py-6 text-sm text-gray-400 italic">
            Nenhuma coluna — adicione pelo menos uma.
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
        <Button onClick={salvar} disabled={salvando}>
          {salvando ? "Salvando…" : "💾 Salvar colunas"}
        </Button>
        {msg && <span className="text-xs">{msg}</span>}
      </div>
    </div>
  );
}

function ColunaRow({
  coluna,
  podeSubir,
  podeDescer,
  onUpdate,
  onMover,
  onRemover,
}: {
  coluna: KanbanColuna;
  podeSubir: boolean;
  podeDescer: boolean;
  onUpdate: (patch: Partial<KanbanColuna>) => void;
  onMover: (delta: number) => void;
  onRemover: () => void;
}) {
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-3 bg-gray-50/50 dark:bg-gray-900/40">
      <div className="flex items-start gap-3">
        {/* Cor visual + botões ↑↓ */}
        <div className="flex flex-col items-center gap-1 pt-1">
          <button
            type="button"
            onClick={() => onMover(-1)}
            disabled={!podeSubir}
            className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Mover pra cima"
          >▲</button>
          <span
            className="w-4 h-4 rounded-full border border-gray-300"
            style={{ backgroundColor: coluna.cor ? `#${coluna.cor}` : "transparent" }}
          />
          <button
            type="button"
            onClick={() => onMover(1)}
            disabled={!podeDescer}
            className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Mover pra baixo"
          >▼</button>
        </div>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2 min-w-0">
          <Input
            label="Nome da coluna"
            value={coluna.nome}
            onChange={(e) => onUpdate({ nome: e.target.value })}
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Migra automaticamente quando status =
            </label>
            <select
              value={coluna.statusAuto || ""}
              onChange={(e) =>
                onUpdate({
                  statusAuto: e.target.value
                    ? (e.target.value as AdmissaoStatus)
                    : undefined,
                })
              }
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            >
              <option value="">— sem regra automática (só manual) —</option>
              {STATUS_OPCOES.map((s) => (
                <option key={s} value={s}>
                  {ADMISSAO_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          {/* Cores */}
          <div className="flex flex-col gap-1 col-span-1 md:col-span-2">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Cor
            </label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {CORES_SUGERIDAS.map((c) => {
                const ativo = coluna.cor === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onUpdate({ cor: c })}
                    className={`w-7 h-7 rounded-full border-2 transition-transform ${
                      ativo ? "border-gray-900 scale-110" : "border-gray-300 hover:scale-110"
                    }`}
                    style={{ backgroundColor: `#${c}` }}
                    title={`#${c}`}
                  />
                );
              })}
              <button
                type="button"
                onClick={() => onUpdate({ cor: undefined })}
                className={`text-[10px] px-2 py-1 rounded-full border ${
                  !coluna.cor ? "border-gray-900 bg-gray-100" : "border-gray-300 hover:bg-gray-100"
                }`}
              >
                sem cor
              </button>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onRemover}
          className="text-rose-600 dark:text-rose-400 hover:underline text-xs whitespace-nowrap"
        >
          ✕ remover
        </button>
      </div>
    </div>
  );
}
