import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./core/auth/AuthContext";
import { RestaurantProvider, useRestaurant } from "./core/restaurant/RestaurantContext";
import { LoginScreen } from "./core/auth/LoginScreen";
import { SignupScreen } from "./core/auth/SignupScreen";
import { AppShell } from "./core/layout/AppShell";
import { HomePage } from "./core/layout/HomePage";
import { ModulePlaceholder } from "./core/layout/ModulePlaceholder";
import { PessoasPage } from "./modules/pessoas/PessoasPage";
import { ConfiguracoesPage } from "./modules/configuracoes/ConfiguracoesPage";
import { EscalaPage } from "./modules/escala/EscalaPage";
import { GorjetasPage } from "./modules/gorjetas/GorjetasPage";
import { VTPage } from "./modules/vt/VTPage";
import { ComunicadosPage } from "./modules/comunicados/ComunicadosPage";
import { IdeiasPage } from "./modules/ideias/IdeiasPage";
import { ReunioesPage } from "./modules/reunioes/ReunioesPage";
import { TrilhaPage } from "./modules/trilha/TrilhaPage";
import { OcorrenciasPage } from "./modules/ocorrencias/OcorrenciasPage";
import { ChecklistsPage } from "./modules/checklists/ChecklistsPage";
import { ReservasPage } from "./modules/reservas/ReservasPage";
import { ContagensPage } from "./modules/contagens/ContagensPage";
import { ComprasPage } from "./modules/compras/ComprasPage";
import { ArquiteturaPage } from "./modules/arquitetura/ArquiteturaPage";
import { PortalPage } from "./modules/portalEmpregado/PortalPage";

function PublicSignup() {
  const { fbUser, loading } = useAuth();
  if (loading) return null;
  if (fbUser) return <Navigate to="/" replace />;
  return <SignupScreen />;
}

function ModuleRouter() {
  const { moduleId, rid } = useParams<{ moduleId: string; rid: string }>();
  const { activeId, setActiveId } = useRestaurant();

  // Sincroniza activeId no contexto com o :rid da URL (URL é source of truth).
  // Usa useEffect pra não disparar setState durante render.
  useEffect(() => {
    if (rid && rid !== activeId) setActiveId(rid);
  }, [rid, activeId, setActiveId]);

  // key força remount quando muda restaurante — limpa estado interno dos forms.
  const k = rid || "";
  switch (moduleId) {
    case "pessoas":       return <PessoasPage key={k} />;
    case "configuracoes": return <ConfiguracoesPage key={k} />;
    case "escala":        return <EscalaPage key={k} />;
    case "gorjetas":      return <GorjetasPage key={k} />;
    case "vt":            return <VTPage key={k} />;
    case "comunicados":   return <ComunicadosPage key={k} />;
    case "ideias":        return <IdeiasPage key={k} />;
    case "reunioes":      return <ReunioesPage key={k} />;
    case "trilha":        return <TrilhaPage key={k} />;
    case "ocorrencias":   return <OcorrenciasPage key={k} />;
    case "checklists":    return <ChecklistsPage key={k} />;
    case "reservas":      return <ReservasPage key={k} />;
    case "contagens":     return <ContagensPage key={k} />;
    case "compras":       return <ComprasPage key={k} />;
    default:              return <ModulePlaceholder key={k} />;
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
          <Route path="/arquitetura" element={<ArquiteturaPage />} />
          <Route path="/portal/:rid" element={<PortalPage />} />
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
        <Routes>
          <Route path="/signup" element={<PublicSignup />} />
          <Route path="*" element={<ProtectedShell />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
