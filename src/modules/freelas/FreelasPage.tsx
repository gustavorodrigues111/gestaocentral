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
import { AgendarTab } from "./AgendarTab";
import { LancamentoTab } from "./LancamentoTab";

type TabId = "agendar" | "lancamento" | "fechamento" | "historico";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "lancamento",  label: "Lançamento", icon: "📝" },
  { id: "agendar",     label: "Agendar",    icon: "📅" },
  { id: "fechamento",  label: "Fechamento", icon: "💰" },
  { id: "historico",   label: "Histórico",  icon: "🗂️" },
];

export function FreelasPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find((r) => r.id === rid) || null;
  const podeUsar = canUse(me, rid, "freelas");
  const podeConfig = canConfig(me, rid, "freelas");

  const [tab, setTab] = useState<TabId>("lancamento");
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
  if (!podeUsar) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const totalAgendados = shifts.filter((s) => s.status === "agendado" && s.date >= hoje).length;
  const totalAbertos   = shifts.filter((s) => (s.status === "aberto" || s.status === "agendado") && s.date <= hoje).length;
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
          {podeConfig && (
            <Button onClick={() => setShowCadastro(true)}>
              + Cadastrar freela
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        {TABS.map((t) => {
          const active = tab === t.id;
          const count =
            t.id === "agendar"     ? totalAgendados :
            t.id === "lancamento"  ? totalAbertos :
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

      {tab === "lancamento" && (
        <LancamentoTab
          restaurantId={rid}
          shifts={shifts}
          empregados={empregados}
          pessoas={pessoas}
          podeEditar={podeConfig}
        />
      )}
      {tab === "agendar" && (
        <AgendarTab
          restaurantId={rid}
          shifts={shifts}
          empregados={empregados}
          pessoas={pessoas}
          podeEditar={podeConfig}
        />
      )}
      {tab === "fechamento" && (
        <Placeholder
          icon="💰"
          title="Fechamento e pagamento"
          subtitle="Agrupa turnos em fechamento em lotes de pagamento — em construção no próximo commit."
          counts={{ pendentes: totalPendentes }}
        />
      )}
      {tab === "historico" && (
        <Placeholder
          icon="🗂️"
          title="Histórico"
          subtitle="Lotes pagos e turnos arquivados — em construção no próximo commit."
          counts={{ pagos: pagamentos.length, "turnos arquivados": totalHistorico }}
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

function Placeholder({
  icon,
  title,
  subtitle,
  counts,
}: {
  icon: string;
  title: string;
  subtitle: string;
  counts: Record<string, number>;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center bg-white/50 dark:bg-gray-900/30">
      <div className="text-4xl mb-2">{icon}</div>
      <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{title}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>
      <div className="mt-4 flex justify-center gap-4 text-[11px] text-gray-500 dark:text-gray-500">
        {Object.entries(counts).map(([k, v]) => (
          <div key={k}>
            <strong className="text-gray-700 dark:text-gray-300">{v}</strong> {k}
          </div>
        ))}
      </div>
    </div>
  );
}
