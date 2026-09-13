import { useParams, Link } from "react-router-dom";
import { getModule } from "../../config/modules";
import { ModuleIcon } from "../ui/ModuleIcon";
import { CircleHelp, Construction } from "lucide-react";

export function ModulePlaceholder() {
  const { moduleId } = useParams<{ moduleId: string }>();
  const m = moduleId ? getModule(moduleId) : null;

  if (!m) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <div className="flex justify-center mb-4 text-gray-400"><CircleHelp size={48} /></div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Módulo não encontrado</h2>
        <Link to="/" className="text-sm text-indigo-600 mt-4 inline-block">← Voltar pro início</Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-16 text-center">
      <div className="mb-4 flex justify-center text-gray-700 dark:text-gray-300"><ModuleIcon name={m.icon} size={48} /></div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{m.label}</h2>
      {m.desc && <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{m.desc}</p>}
      <div className="mt-6 inline-block bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-900 rounded-lg px-4 py-3 text-sm text-amber-900 dark:text-amber-300">
        <span className="inline-flex items-center gap-1.5"><Construction size={15} /> {m.status === "em-breve" ? "Em desenvolvimento — chega no próximo sprint" : "Planejado pros próximos sprints"}</span>
      </div>
      <div>
        <Link to="/" className="text-sm text-indigo-600 mt-6 inline-block">← Voltar pro início</Link>
      </div>
    </div>
  );
}
