// ════════════════════════════════════════════════════════════════════════════
//  Modal de vincular Pessoa existente a este restaurante
//
//  Lista TODAS as pessoas cadastradas (mesmo as que não estão neste rest).
//  Filtro de busca por nome/CPF. Esconde quem já está vinculada.
//  Ao clicar em "Vincular", adiciona o rid em `restaurantIds` + `novosRestaurantes`
//  (a pessoa vai ver badge "📨 Você foi adicionada a X" no próximo login).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { logAudit } from "../../core/audit/versionedChange";
import type { Pessoa } from "../../core/types";

type Props = {
  restaurantId: string;
  onClose: () => void;
};

export function VincularPessoaModal({ restaurantId, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const [todasPessoas, setTodasPessoas] = useState<Pessoa[]>([]);
  const [search, setSearch] = useState("");
  const [vinculandoId, setVinculandoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Lê TODAS as pessoas (sem filtro de rid)
  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(collection(db, "pessoas"), (snap) => {
      setTodasPessoas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Filtra: tira quem já é deste rest + aplica busca
  const candidatas = useMemo(() => {
    const s = search.trim().toLowerCase().replace(/\D/g, "");  // pra busca por CPF
    const sNome = search.trim().toLowerCase();
    return todasPessoas
      .filter(p => !(p.restaurantIds || []).includes(restaurantId))
      .filter(p => p.ativa !== false)
      .filter(p => {
        if (!search.trim()) return true;
        const nomeOk = (p.nome || "").toLowerCase().includes(sNome);
        const cpfOk = s && (p.cpf || "").includes(s);
        return nomeOk || cpfOk;
      })
      .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
  }, [todasPessoas, restaurantId, search]);

  async function vincular(pessoa: Pessoa) {
    if (!me) return;
    setVinculandoId(pessoa.id);
    try {
      const novosRestIds = Array.from(new Set([
        ...(pessoa.restaurantIds || []),
        restaurantId,
      ]));
      const novosBadge = Array.from(new Set([
        ...(pessoa.novosRestaurantes || []),
        restaurantId,
      ]));
      await updateDoc(doc(db, "pessoas", pessoa.id), {
        restaurantIds: novosRestIds,
        novosRestaurantes: novosBadge,
      });
      await logAudit({
        entityType: "pessoa",
        entityId: pessoa.id,
        restaurantId,
        acao: "alterado",
        motivo: "Vinculada a novo restaurante",
        registradoPor: me.id,
      });
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Erro");
    } finally {
      setVinculandoId(null);
    }
  }

  const restMap = Object.fromEntries(restaurants.map(r => [r.id, r]));

  return (
    <Modal title="🔗 Vincular pessoa existente" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Pessoa já cadastrada em outro restaurante? Busca abaixo e vincula a este.
          Ela ganha acesso na hora e vê um aviso "📨 Você foi adicionada a este restaurante"
          no próximo login.
        </p>

        <Input
          autoFocus
          placeholder="🔍 Buscar por nome ou CPF..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {loading ? (
          <div className="text-sm text-gray-500 text-center py-4">Carregando...</div>
        ) : candidatas.length === 0 ? (
          <div className="text-sm text-gray-500 text-center py-8">
            {search.trim()
              ? "Nenhuma pessoa encontrada com esse nome/CPF."
              : "Todas as pessoas já estão vinculadas a este restaurante."}
          </div>
        ) : (
          <div className="border border-gray-200 dark:border-gray-800 rounded-lg max-h-[400px] overflow-y-auto">
            {candidatas.map(p => {
              const rids = p.restaurantIds || [];
              const restNomes = rids
                .map(r => restMap[r]?.nome || r)
                .join(", ");
              const isVinculando = vinculandoId === p.id;
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 flex-wrap">
                      {p.nome}
                      {p.cadastroIncompleto && (
                        <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                          ⚠ Cadastro incompleto
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {p.cpf ? `CPF ${formatarCpf(p.cpf)}` : "sem CPF"}
                      {p.email && <> · {p.email}</>}
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                      🏢 em {rids.length} restaurante{rids.length !== 1 ? "s" : ""}: <em>{restNomes || "—"}</em>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => vincular(p)}
                    disabled={isVinculando}
                  >
                    {isVinculando ? "..." : "🔗 Vincular"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </Modal>
  );
}

function formatarCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}
