// ════════════════════════════════════════════════════════════════════════════
//  Aba "Compatibilidade de Cadastros" — router de sub-tabs.
//
//   - "Quadros de horários" (unidirecional Sólides → Planejamento; API só
//     expõe leitura de work-schedule)
//   - "Cargos" (bidirecional Planejamento ↔ Sólides; suporta criação nos
//     dois lados pra master)
//
//  Próximas fases trarão mais sub-tabs (empregados, etc).
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { CargosSubTab } from "./compatibilidade/CargosSubTab";
import { QuadrosSubTab } from "./compatibilidade/QuadrosSubTab";

type Props = { rid: string };

type SubTab = "quadros" | "cargos";

const SUBTABS: Array<{ id: SubTab; label: string }> = [
  { id: "quadros", label: "Quadros de horários" },
  { id: "cargos",  label: "Cargos" },
];

export function CompatibilidadeTab({ rid }: Props) {
  const [subtab, setSubtab] = useState<SubTab>("quadros");

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {SUBTABS.map((t) => {
          const ativo = subtab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubtab(t.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                ativo
                  ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {subtab === "quadros" && <QuadrosSubTab rid={rid} />}
      {subtab === "cargos"  && <CargosSubTab  rid={rid} />}
    </div>
  );
}
