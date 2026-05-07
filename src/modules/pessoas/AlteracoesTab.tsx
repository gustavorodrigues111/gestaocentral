import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { AuditLog, Empregado, Pessoa } from "../../core/types";

type Props = { restaurantId: string };

const ACAO_LABEL: Record<AuditLog["acao"], { label: string; icon: string; cls: string }> = {
  criado:    { label: "Criado",     icon: "✨", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  alterado:  { label: "Alterado",   icon: "✏️", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  agendado:  { label: "Agendado",   icon: "⏰", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  inativado: { label: "Inativado",  icon: "🚫", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
  reativado: { label: "Reativado",  icon: "✓", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  demitido:  { label: "Demitido",   icon: "📤", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
  readmitido:{ label: "Readmitido", icon: "📥", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  excluido:  { label: "Excluído",   icon: "🗑", cls: "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
};

const ENTITY_LABEL: Record<string, string> = {
  pessoa: "Pessoa",
  empregado: "Empregado",
  cargo: "Cargo",
  restaurant: "Restaurante",
  gorjeta: "Gorjeta",
  vtFolha: "VT Folha",
  permissionTemplate: "Template",
};

export function AlteracoesTab({ restaurantId }: Props) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroEntidade, setFiltroEntidade] = useState<string>("todos");
  const [filtroPeriodo, setFiltroPeriodo] = useState<"7d" | "30d" | "90d" | "todos">("30d");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Audit log: filtrar por restaurantId
        const qLogs = query(
          collection(db, "auditLog"),
          where("restaurantId", "==", restaurantId),
        );
        const [snapLogs, snapEmps, snapPess] = await Promise.all([
          getDocs(qLogs),
          getDocs(query(collection(db, "empregados"), where("restaurantId", "==", restaurantId))),
          getDocs(query(collection(db, "pessoas"), where("restaurantIds", "array-contains", restaurantId))),
        ]);
        if (!alive) return;
        const list = snapLogs.docs.map(d => ({ id: d.id, ...d.data() }) as AuditLog);
        list.sort((a, b) => (b.registradoEm || "").localeCompare(a.registradoEm || ""));
        setLogs(list);
        setEmpregados(snapEmps.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado));
        setPessoas(snapPess.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa));
      } catch (e) {
        console.error("Erro carregando alterações:", e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [restaurantId]);

  // Mapeia entityId → nome legível
  const nameMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of empregados) m[e.id] = e.nome;
    for (const p of pessoas) m[p.id] = p.nome;
    return m;
  }, [empregados, pessoas]);

  const filtered = useMemo(() => {
    return logs.filter(l => {
      if (filtroEntidade !== "todos" && l.entityType !== filtroEntidade) return false;
      if (filtroPeriodo !== "todos") {
        const dias = filtroPeriodo === "7d" ? 7 : filtroPeriodo === "30d" ? 30 : 90;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - dias);
        const cutoffIso = cutoff.toISOString();
        if (l.registradoEm < cutoffIso) return false;
      }
      return true;
    });
  }, [logs, filtroEntidade, filtroPeriodo]);

  const nomePessoa = (pessoaId: string) =>
    pessoas.find(p => p.id === pessoaId)?.nome || "?";

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {filtered.length} alteração{filtered.length !== 1 ? "ões" : ""}
        </p>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Histórico de mudanças críticas no sistema (criação, edição, demissão, reativação, etc).
        Útil pra DP acompanhar quem alterou o quê e quando.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mr-1">Período:</span>
        {(["7d", "30d", "90d", "todos"] as const).map(p => (
          <FilterChip key={p} active={filtroPeriodo === p} onClick={() => setFiltroPeriodo(p)}>
            {p === "7d" ? "7 dias" : p === "30d" ? "30 dias" : p === "90d" ? "90 dias" : "Todos"}
          </FilterChip>
        ))}
        <span className="ml-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 mr-1">Tipo:</span>
        <select
          value={filtroEntidade}
          onChange={(e) => setFiltroEntidade(e.target.value)}
          className="text-xs px-3 py-1 rounded-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        >
          <option value="todos">Todos</option>
          <option value="empregado">Empregado</option>
          <option value="cargo">Cargo</option>
          <option value="pessoa">Pessoa</option>
          <option value="restaurant">Restaurante</option>
          <option value="permissionTemplate">Template</option>
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhuma alteração no período</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          {filtered.map((log, i) => {
            const acao = ACAO_LABEL[log.acao] || ACAO_LABEL.alterado;
            const entLabel = ENTITY_LABEL[log.entityType] || log.entityType;
            const entityName = nameMap[log.entityId] || log.entityId.slice(0, 8);
            const data = log.registradoEm
              ? new Date(log.registradoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
              : "—";
            const diffEntries = log.diff ? Object.entries(log.diff) : [];
            return (
              <div
                key={log.id || i}
                className={`px-4 py-3 ${i > 0 ? "border-t border-gray-100 dark:border-gray-800" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${acao.cls}`}>
                    {acao.icon} {acao.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">
                      <span className="text-gray-500 dark:text-gray-400">{entLabel}:</span>{" "}
                      <span className="font-medium text-gray-900 dark:text-gray-100">{entityName}</span>
                      {log.vigenteApartir && (
                        <span className="ml-2 text-[11px] text-amber-700 dark:text-amber-400">
                          a partir de {log.vigenteApartir}
                        </span>
                      )}
                    </div>
                    {log.motivo && (
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 italic">
                        "{log.motivo}"
                      </div>
                    )}
                    {diffEntries.length > 0 && (
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 space-y-0.5">
                        {diffEntries.slice(0, 3).map(([campo, vals]) => (
                          <div key={campo}>
                            <span className="font-mono">{campo}:</span>{" "}
                            <span className="line-through opacity-60">{fmtVal(vals.antes)}</span>
                            {" → "}
                            <span className="text-gray-700 dark:text-gray-300">{fmtVal(vals.depois)}</span>
                          </div>
                        ))}
                        {diffEntries.length > 3 && (
                          <div className="opacity-60">+{diffEntries.length - 3} campo(s) mais...</div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right text-[11px] text-gray-400 flex-shrink-0">
                    <div>{data}</div>
                    <div className="text-[10px] opacity-70">por {nomePessoa(log.registradoPor)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (typeof v === "string") return v.length > 30 ? v.slice(0, 30) + "…" : v;
  if (typeof v === "number") return String(v);
  return JSON.stringify(v).slice(0, 30);
}

function FilterChip({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
        active
          ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
