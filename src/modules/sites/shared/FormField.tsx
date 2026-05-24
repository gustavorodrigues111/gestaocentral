import type { ReactNode } from "react";

// Wrapper consistente pros forms públicos (Reservas, Trabalhe, Eventos).
// Resolve o problema de boxes com larguras diferentes que aparecia quando
// misturávamos <Input> do core/ui com <input> nativo + classes Tailwind.
//
// Uso:
//   <FormField label="Seu nome *">
//     <input className={fieldInputCls} ... />
//   </FormField>
//
//   <FormField label="Observações">
//     <textarea className={fieldInputCls + " resize-y"} ... />
//   </FormField>

export function FormField({
  label, dica, children,
}: {
  label: string;
  dica?: string;
  children: ReactNode;
}) {
  // min-w-0 no wrapper evita que filhos com intrinsic-width grande
  // (notadamente input type=date no Safari, que reserva pixels do
  // indicador nativo) estourem a largura do container flex.
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label className="text-xs font-semibold text-gray-600">
        {label}
      </label>
      {children}
      {dica && <p className="text-[11px] text-gray-400">{dica}</p>}
    </div>
  );
}

// Classes compartilhadas pra qualquer input/select/textarea dos forms.
// Inclui w-full, padding e border iguais, foco indigo, fundo branco
// (forms são sempre sobre o card claro do SiteFormShell).
//
// box-border + box-sizing garante que width=100% inclua padding/borda
// (problema visível no Safari iOS com input type=date que renderiza
// indicador nativo e estoura o box-content).
export const fieldInputCls =
  "block w-full box-border min-w-0 px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white " +
  "focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500";
