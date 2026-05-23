import { useParams } from "react-router-dom";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canUse, canConfig } from "../../core/auth/permissions";

// Página esqueleto do módulo Eventos. PR1 só registra a rota + permissão.
// Próximos PRs adicionam: cadastro de Espaço (PR2), Pacote (PR3), formulário
// público (PR4), Kanban + Card (PR5), proposta (PR6), pagamento (PR7), BEO
// e templates (PR8).
export function EventosPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find(r => r.id === rid) || null;
  const podeUsar = canUse(me, rid, "eventos");
  const podeConfigurar = canConfig(me, rid, "eventos");

  if (!activeRestaurant) {
    return <div className="text-gray-500">Selecione um restaurante.</div>;
  }
  if (!podeUsar) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          Peça pro administrador habilitar o módulo Eventos pra você.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            🎉 Eventos
            <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              em desenvolvimento
            </span>
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Captação, propostas e BEO de eventos privados.
          </p>
        </div>
      </div>

      <div className="rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 p-4 text-sm text-indigo-900 dark:text-indigo-200">
        <p className="font-semibold mb-1">🚧 Módulo sendo construído por etapas</p>
        <p className="text-[13px] opacity-90">
          Esqueleto criado (rota + permissão). Próximos passos:
        </p>
        <ol className="text-[13px] mt-2 list-decimal pl-5 space-y-0.5 opacity-90">
          <li>Cadastrar o espaço (Laje) e seus recursos nas Configurações</li>
          <li>Cadastrar pacotes de evento</li>
          <li>Liberar o formulário público pra cliente preencher interesse</li>
          <li>Kanban de leads + montagem de proposta</li>
          <li>BEO + templates de mensagem</li>
        </ol>
        {podeConfigurar && (
          <p className="text-[12px] mt-3 opacity-80">
            (Você tem permissão de configurar — quando os cadastros estiverem prontos, vão
            aparecer aqui pra você.)
          </p>
        )}
      </div>
    </div>
  );
}
