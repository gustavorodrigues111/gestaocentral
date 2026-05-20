// ════════════════════════════════════════════════════════════════════════════
//  Modal usado quando o canal preferido do contato externo é "telefone".
//  Mostra número grande, script sugerido pra falar com o atendente, e
//  botões "Copiar número" / "Copiar script" / "Ligar agora" (tel:).
//
//  Em desktop, `tel:` pode abrir FaceTime/discador do macOS; em mobile abre
//  o app de telefone. Em qualquer caso, copiar manualmente é a alternativa.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type { ContatoExterno } from "../../core/types";

type Props = {
  contato: ContatoExterno;
  scriptSugerido: string;
  onClose: () => void;
  onConfirmar?: () => void; // chamado quando RH clica "Já liguei"
};

export function ModalLigarContato({ contato, scriptSugerido, onClose, onConfirmar }: Props) {
  const [copiouNum, setCopiouNum] = useState(false);
  const [copiouScript, setCopiouScript] = useState(false);

  const telLimpo = (contato.telefone || "").replace(/\D/g, "");
  const telLink = telLimpo ? `tel:+55${telLimpo}` : undefined;

  async function copiarNumero() {
    if (!contato.telefone) return;
    try {
      await navigator.clipboard.writeText(contato.telefone);
      setCopiouNum(true);
      setTimeout(() => setCopiouNum(false), 2000);
    } catch {
      alert("Não consegui copiar — selecione manualmente.");
    }
  }
  async function copiarScript() {
    try {
      await navigator.clipboard.writeText(scriptSugerido);
      setCopiouScript(true);
      setTimeout(() => setCopiouScript(false), 2000);
    } catch {
      alert("Não consegui copiar — selecione manualmente.");
    }
  }

  return (
    <Modal title={`📞 Ligar para ${contato.nome}`} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-400">
            Telefone
          </div>
          <div className="font-mono text-2xl font-bold text-amber-900 dark:text-amber-200 mt-0.5">
            {contato.telefone || "(não cadastrado)"}
          </div>
          {contato.endereco && (
            <div className="text-[11px] text-amber-800 dark:text-amber-300 mt-1">
              📍 {contato.endereco}
            </div>
          )}
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Script sugerido (pra falar com o atendente):
          </div>
          <pre className="bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-sans">
{scriptSugerido}
          </pre>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={copiarNumero} disabled={!contato.telefone}>
            📋 {copiouNum ? "Copiado!" : "Copiar número"}
          </Button>
          <Button size="sm" variant="secondary" onClick={copiarScript}>
            📋 {copiouScript ? "Copiado!" : "Copiar script"}
          </Button>
          {telLink && (
            <a
              href={telLink}
              className="inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-600 text-xs px-2.5 py-1.5"
            >
              📞 Ligar agora
            </a>
          )}
        </div>

        {onConfirmar && (
          <div className="flex justify-end pt-2 border-t border-gray-100 dark:border-gray-800">
            <Button size="sm" onClick={() => { onConfirmar(); onClose(); }}>
              ✓ Já liguei (marcar como feito)
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
