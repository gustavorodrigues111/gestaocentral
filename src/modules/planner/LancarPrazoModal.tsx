// Lançar prazo pelo Planner: escolhe o tipo e abre o form do módulo de origem,
// que grava na coleção certa (e aí aparece na agenda correspondente).
// Experiência é derivada da admissão — não entra como lançamento manual.
import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import { ContaFixaForm } from "../contasFixas/ContasFixasPage";
import { ManutencaoForm } from "../manutencoes/ManutencoesPage";
import type { Endereco } from "../../core/types";

type Tipo = "conta" | "tecnico";

export function LancarPrazoModal({ onClose }: { onClose: () => void }) {
  const { pessoa } = useAuth();
  const { restaurants } = useRestaurant();
  const [tipo, setTipo] = useState<Tipo | null>(null);
  const [enderecos, setEnderecos] = useState<Endereco[]>([]);
  const ridsKey = restaurants.map(r => r.id).join(",");
  useEffect(() => {
    const rids = ridsKey ? ridsKey.split(",").slice(0, 10) : [];
    if (!rids.length) { setEnderecos([]); return; }
    const u = onSnapshot(query(collection(db, "enderecos"), where("restaurantId", "in", rids)),
      s => setEnderecos(s.docs.map(d => ({ id: d.id, ...d.data() }) as Endereco)), () => setEnderecos([]));
    return () => u();
  }, [ridsKey]);

  if (!pessoa) return null;
  const rest = restaurants.map(r => ({ id: r.id, nome: r.nome }));

  // Os forms já trazem o seletor de empresa/endereço dentro deles.
  if (tipo === "conta") return <ContaFixaForm conta={null} onClose={onClose} restaurantes={rest} enderecos={enderecos} pessoaId={pessoa.id} />;
  if (tipo === "tecnico") return <ManutencaoForm manutencao={null} onClose={onClose} restaurants={rest} enderecos={enderecos} pessoaId={pessoa.id} />;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">Lançar prazo</h2>
        <p className="text-xs text-gray-500 mb-4">Escolha o tipo — grava no módulo de origem e aparece na agenda certa.</p>
        <div className="space-y-2">
          <button type="button" onClick={() => setTipo("conta")} className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 text-left">
            <span className="text-2xl">💵</span><div><div className="font-medium text-gray-900 dark:text-gray-100">Conta Fixa</div><div className="text-xs text-gray-500 dark:text-gray-400">Pagamento recorrente (aluguel, imposto, sistema)</div></div>
          </button>
          <button type="button" onClick={() => setTipo("tecnico")} className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 text-left">
            <span className="text-2xl">🛠️</span><div><div className="font-medium text-gray-900 dark:text-gray-100">Prazo Técnico</div><div className="text-xs text-gray-500 dark:text-gray-400">Manutenção, licença, certificado</div></div>
          </button>
        </div>
        <div className="flex justify-end mt-4"><Button variant="ghost" onClick={onClose}>Cancelar</Button></div>
      </div>
    </div>
  );
}
