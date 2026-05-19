import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfig, canUse } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import type {
  Empregado,
  FreelaPagamento,
  FreelaShift,
  Pessoa,
} from "../../core/types";
import { CadastroRapidoFreelaModal } from "./CadastroRapidoFreelaModal";
import { LancamentoTab } from "./LancamentoTab";
import { FechamentoTab } from "./FechamentoTab";
import { HistoricoTab } from "./HistoricoTab";

type TabId = "lancamentos" | "fechamento" | "historico";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "lancamentos", label: "Lançamentos", icon: "📝" },
  { id: "fechamento",  label: "Fechamento",  icon: "💰" },
  { id: "historico",   label: "Histórico",   icon: "🗂️" },
];

export function FreelasPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find((r) => r.id === rid) || null;

  // 2 papéis distintos:
  //   - Operacional (ver): cria turno, mexe em entrada/saída/intervalo, marca no-show
  //   - DP (configurar): precifica (tipo + valor), confirma fechamento, gera lote, marca pago
  const podeOperar = canUse(me, rid, "freelas");
  const podeDp     = canConfig(me, rid, "freelas");

  const [tab, setTab] = useState<TabId>("lancamentos");
  const [showCadastro, setShowCadastro] = useState(false);

  const [shifts, setShifts] = useState<FreelaShift[]>([]);
  const [pagamentos, setPagamentos] = useState<FreelaPagamento[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "freelaShifts"), where("restaurantId", "==", rid));
    return onSnapshot(q, (snap) => {
      setShifts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FreelaShift)));
    });
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "freelaPagamentos"), where("restaurantId", "==", rid));
    return onSnapshot(q, (snap) => {
      setPagamentos(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FreelaPagamento)));
    });
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "empregados"), where("restaurantId", "==", rid));
    return onSnapshot(q, (snap) => {
      setEmpregados(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Empregado)));
    });
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid));
    return onSnapshot(q, (snap) => {
      setPessoas(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Pessoa)));
    });
  }, [rid]);

  if (!activeRestaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (!podeOperar) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  const totalAbertos   = shifts.filter((s) => s.status === "aberto" || s.status === "agendado" || s.status === "fechamento").length;
  const totalPendentes = shifts.filter((s) => s.status === "fechamento" && !s.lotePagamentoId).length;
  const totalHistorico = shifts.filter((s) => s.status === "pago" || s.status === "nao_compareceu").length;

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">🎒 Freelas</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Cadastro, agendamento, lançamento e pagamento de freelas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {podeOperar && (
            <Button onClick={() => setShowCadastro(true)}>
              + Cadastrar freela
            </Button>
          )}
        </div>
      </div>

      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        {TABS.map((t) => {
          const active = tab === t.id;
          const count =
            t.id === "lancamentos" ? totalAbertos :
            t.id === "fechamento"  ? totalPendentes :
                                     totalHistorico;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                active
                  ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                  : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
              }`}
            >
              {t.icon} {t.label}
              {count > 0 && (
                <span
                  className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                    active
                      ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                      : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "lancamentos" && (
        <LancamentoTab
          restaurantId={rid}
          shifts={shifts}
          empregados={empregados}
          pessoas={pessoas}
          podeOperar={podeOperar}
        />
      )}
      {tab === "fechamento" && (
        <FechamentoTab
          restaurantId={rid}
          shifts={shifts}
          pagamentos={pagamentos}
          podeEditar={podeDp}
        />
      )}
      {tab === "historico" && (
        <HistoricoTab
          shifts={shifts}
          pagamentos={pagamentos}
          restaurant={activeRestaurant}
        />
      )}

      {showCadastro && (
        <CadastroRapidoFreelaModal
          restaurantId={rid}
          onSaved={() => setShowCadastro(false)}
          onClose={() => setShowCadastro(false)}
        />
      )}
    </div>
  );
}
