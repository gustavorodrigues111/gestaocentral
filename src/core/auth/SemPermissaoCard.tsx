// Componente reusável de "sem permissão" pra módulos do tipo "área de
// gestão com correspondente no Meu Portal" (Escala, Gorjetas, VT,
// Reuniões). Quando pessoa não tem capability de gestão (verTime, etc.),
// mostra mensagem amigável apontando pro Meu Portal.
//
// Pra módulos puros de gestão (Pessoas, Sites, etc.) que não têm
// equivalente no Meu Portal, use uma versão simples sem o link.

import { Link } from "react-router-dom";

type Props = {
  /** Restaurante atual — pra link do portal. */
  restaurantId: string;
  /** Emoji + texto pra identificar o que a pessoa procurava (ex: "💰 Sua gorjeta"). */
  icone: string;
  titulo: string;
  /** Frase explicando o que aquela tela é. */
  descricao: string;
};

export function SelfServiceRedirect({ restaurantId, icone, titulo, descricao }: Props) {
  return (
    <div className="max-w-2xl mx-auto py-12 text-center space-y-3">
      <div className="text-4xl">{icone}</div>
      <p className="text-gray-700 dark:text-gray-300 font-medium">{titulo}</p>
      <p className="text-sm text-gray-500 dark:text-gray-400">{descricao}</p>
      <Link
        to={`/portal/${restaurantId}`}
        className="inline-block px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
      >
        Ir pro Meu Portal
      </Link>
    </div>
  );
}

/** Mensagem genérica de sem permissão (módulos sem Meu Portal). */
export function SemPermissaoCard() {
  return (
    <div className="max-w-2xl mx-auto py-12 text-center">
      <div className="text-4xl mb-3">🔒</div>
      <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
    </div>
  );
}
