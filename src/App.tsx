import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./core/auth/AuthContext";
import { RestaurantProvider } from "./core/restaurant/RestaurantContext";
import { LoginScreen } from "./core/auth/LoginScreen";
import { AppShell } from "./core/layout/AppShell";
import { HomePage } from "./core/layout/HomePage";
import { ModulePlaceholder } from "./core/layout/ModulePlaceholder";
import { PessoasPage } from "./modules/pessoas/PessoasPage";
import { ConfiguracoesPage } from "./modules/configuracoes/ConfiguracoesPage";

function ModuleRouter() {
  const { moduleId } = useParams<{ moduleId: string }>();
  switch (moduleId) {
    case "pessoas":       return <PessoasPage />;
    case "configuracoes": return <ConfiguracoesPage />;
    default:              return <ModulePlaceholder />;
  }
}

function ProtectedShell() {
  const { fbUser, pessoa, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">
        Carregando...
      </div>
    );
  }
  if (!fbUser) return <LoginScreen />;
  if (!pessoa) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center">
        <div>
          <div className="text-4xl mb-3">🔒</div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Conta não vinculada</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-sm">
            Sua conta {fbUser.email} foi autenticada, mas não tem registro de Pessoa no sistema.
            Peça pro administrador criar seu cadastro.
          </p>
        </div>
      </div>
    );
  }

  return (
    <RestaurantProvider>
      <AppShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/r/:rid/:moduleId" element={<ModuleRouter />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </RestaurantProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ProtectedShell />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
