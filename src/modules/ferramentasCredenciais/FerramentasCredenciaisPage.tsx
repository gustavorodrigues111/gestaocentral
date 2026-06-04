// ════════════════════════════════════════════════════════════════════════════
//  Ferramentas e Credenciais — catálogo de acessos a sistemas externos.
//
//  Princípio: o app NÃO guarda senha. Só metadado + link pro Bitwarden.
//
//  Esta página é o entrypoint. Renderiza 2 modos:
//   - "Minhas Ferramentas" (default): só as tools onde user está em
//     usuariosAutorizados. Vê quem tem qualquer perfil com ação
//     ferramentasCredenciais.acessar
//   - "Gerenciar todas" (master/quem tem .gerenciar): lista todas, CRUD
// ════════════════════════════════════════════════════════════════════════════

import { useAuth } from "../../core/auth/AuthContext";

export function FerramentasCredenciaisPage() {
  const { pessoa: me } = useAuth();
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
        🔑 Ferramentas e Credenciais
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Catálogo de ferramentas externas (iFood, Lalamove, fornecedores).
      </p>
      <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400">
        <div className="text-4xl mb-3">🚧</div>
        <p className="font-medium">Módulo em construção</p>
        <p className="text-xs mt-2">Olá, {me?.nome || "—"} — em breve.</p>
      </div>
    </div>
  );
}
