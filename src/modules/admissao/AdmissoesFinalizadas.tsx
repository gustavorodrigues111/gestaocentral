// Lista de admissões finalizadas — viraram histórico depois que o DP
// clicou em "✓ Finalizar admissão" na etapa final do Kanban. Permite
// reativar (manda de volta pro Kanban no mesmo status).

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { normalizarAdmissao, reativarAdmissao } from "../../core/admissao/admissaoHelpers";
import type { Admissao } from "../../core/types";

function fmtDateTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export function AdmissoesFinalizadas({ rid }: { rid: string }) {
  const { pessoa: me } = useAuth();
  const [admissoes, setAdmissoes] = useState<Admissao[]>([]);
  const [busca, setBusca] = useState("");
  const [reativandoId, setReativandoId] = useState<string | null>(null);

  useEffect(() => {
    if (!rid) return;
    const u = onSnapshot(
      query(collection(db, "admissoes"), where("restaurantId", "==", rid)),
      (snap) => setAdmissoes(
        snap.docs
          .map(d => normalizarAdmissao({ id: d.id, ...d.data() } as Admissao))
          .filter(a => !!a.finalizadoEm),
      ),
    );
    return () => u();
  }, [rid]);

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const filtrada = q
      ? admissoes.filter(a =>
          a.candidato.nome.toLowerCase().includes(q) ||
          (a.candidato.cpf || "").includes(q.replace(/\D/g, "")))
      : admissoes;
    return [...filtrada].sort((a, b) =>
      (b.finalizadoEm || "").localeCompare(a.finalizadoEm || ""));
  }, [admissoes, busca]);

  async function reativar(adm: Admissao) {
    if (!me) return;
    if (!confirm(`Reativar a admissão de ${adm.candidato.nome}? Ela volta pro Kanban.`)) return;
    setReativandoId(adm.id);
    try {
      await reativarAdmissao(adm.id);
    } finally {
      setReativandoId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome ou CPF…"
          className="flex-1 min-w-[200px] px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        />
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {lista.length} finalizada(s)
        </span>
      </div>

      {lista.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">
          Nenhuma admissão finalizada
          {busca && " com esse filtro"}.
        </div>
      ) : (
        <div className="space-y-1.5">
          {lista.map(a => (
            <div
              key={a.id}
              className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 flex items-center gap-3 flex-wrap"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                  {a.candidato.nome}
                </div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  Finalizada em {fmtDateTime(a.finalizadoEm)}
                  {a.finalizadoPor?.nome && ` · por ${a.finalizadoPor.nome}`}
                  {a.dataAdmissao && ` · admitido ${a.dataAdmissao}`}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => reativar(a)}
                disabled={reativandoId === a.id}
              >
                {reativandoId === a.id ? "Reativando…" : "↩ Reativar"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
