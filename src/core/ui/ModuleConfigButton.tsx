import { useState, type ReactNode } from "react";
import { Modal } from "./Modal";

/**
 * Botão de engrenagem ⚙️ que aparece no canto sup direito da página de um módulo.
 * Quando clicado, abre um modal com as configurações específicas daquele módulo.
 *
 * Uso:
 * <ModuleConfigButton title="Configurações de Gorjetas" disabled={!podeConfig}>
 *   <Input ... />
 *   ...
 * </ModuleConfigButton>
 */
export function ModuleConfigButton({
  title,
  children,
  disabled,
}: {
  title: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={`w-9 h-9 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-base flex items-center justify-center transition-colors ${
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
        }`}
        title={disabled ? "Sem permissão" : title}
        aria-label={title}
      >
        ⚙️
      </button>
      {open && (
        <Modal title={title} onClose={() => setOpen(false)} maxWidth="max-w-lg">
          {children}
        </Modal>
      )}
    </>
  );
}
