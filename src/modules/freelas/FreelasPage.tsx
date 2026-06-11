import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import type {
  Empregado,
  FreelaPagamento,
  FreelaShift,
  Pessoa,
} from "../../core/types";
import { CadastroRapidoFreelaModal } from "./CadastroRapidoFreelaModal";
import { ImportLoteFreelasModal } from "./ImportLoteFreelasModal";
import { LancamentoTab } from "./LancamentoTab";
import { FechamentoTab } from "./FechamentoTab";
import { HistoricoTab } from "./HistoricoTab";

type TabId = "lancamentos" | "fechamento" | "historico";

const TABS_DEF: { id: TabId; label: string; icon: string }[] = [
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

  // Permissões EXPLÍCITAS por checkbox da matriz (não usar canVer/canConfig
  // aqui — canVer dá true quando só "configurar" está marcado, e queremos
  // distinguir os 2 papéis):
  //   - "ver"        → acesso completo à tela LANÇAMENTOS
  //   - "configurar" → acesso completo a FECHAMENTO + HISTÓRICO
  //   - master → tudo
  const isMaster = !!me?.isMaster;
  const podeOperar = isMaster || me?.permissions?.[rid]?.freelas?.ver === true;
  const podeDp     = isMaster || me?.permissions?.[rid]?.freelas?.configurar === true;

  const tabsVisiveis = useMemo<TabId[]>(() => {
    const out: TabId[] = [];
    if (podeOperar) out.push("lancamentos");
    if (podeDp)     out.push("fechamento", "historico");
    return out;
  }, [podeOperar, podeDp]);

  const [tab, setTab] = useState<TabId>(() => tabsVisiveis[0] || "lancamentos");
  const [showCadastro, setShowCadastro] = useState(false);
  const [showNovoTurno, setShowNovoTurno] = useState(false);   // planejar
  const [showAvulsoTurno, setShowAvulsoTurno] = useState(false); // abrir agora
  const [showImportLote, setShowImportLote] = useState(false);

  // Se a aba atual sumir (mudou permissão), pula pra primeira disponível
  useEffect(() => {
    if (!tabsVisiveis.includes(tab) && tabsVisiveis.length > 0) {
      setTab(tabsVisiveis[0]);
    }
  }, [tabsVisiveis, tab]);

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
  if (!podeOperar && !podeDp) {
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
      <div className="mb-4">
        {podeOperar && tab === "lancamentos" && (
          <div className="mt-3 space-y-2 max-w-md">
            {/* Ações principais: Planejar + Abrir lado a lado */}
            <div className="grid grid-cols-2 gap-2">
              <Button className="w-full" onClick={() => setShowNovoTurno(true)}>📋 Planejar turno</Button>
              <Button className="w-full" onClick={() => setShowAvulsoTurno(true)}>🟢 Abrir turno</Button>
            </div>
            {/* Cadastro: largura cheia, mais fino */}
            <Button variant="secondary" size="sm" className="w-full" onClick={() => setShowCadastro(true)}>
              + Cadastrar novo freela
            </Button>
            {/* PROVISÓRIO — importação em lote (master). */}
            {isMaster && (
              <Button variant="secondary" size="sm" className="w-full" onClick={() => setShowImportLote(true)}>
                🧪 Importar lote
              </Button>
            )}
          </div>
        )}
        {podeOperar && tab !== "lancamentos" && (
          <div className="mt-3 max-w-md">
            <Button variant="secondary" size="sm" className="w-full" onClick={() => setShowCadastro(true)}>
              + Cadastrar novo freela
            </Button>
          </div>
        )}
      </div>

      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        {TABS_DEF.filter((t) => tabsVisiveis.includes(t.id)).map((t) => {
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

      {tab === "lancamentos" && podeOperar && (
        <LancamentoTab
          restaurantId={rid}
          shifts={shifts}
          empregados={empregados}
          pessoas={pessoas}
          podeOperar={podeOperar}
          showNovo={showNovoTurno}
          onCloseNovo={() => setShowNovoTurno(false)}
          showAvulso={showAvulsoTurno}
          onCloseAvulso={() => setShowAvulsoTurno(false)}
        />
      )}
      {tab === "fechamento" && podeDp && (
        <FechamentoTab
          restaurantId={rid}
          restaurant={activeRestaurant}
          shifts={shifts}
          pagamentos={pagamentos}
          podeEditar={podeDp}
        />
      )}
      {tab === "historico" && podeDp && (
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
      {showImportLote && (
        <ImportLoteFreelasModal
          restaurantId={rid}
          onClose={() => setShowImportLote(false)}
          onImported={() => { /* fica aberto pro user ver o log */ }}
        />
      )}
    </div>
  );
}
