import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./core/auth/AuthContext";
import { RestaurantProvider, useRestaurant } from "./core/restaurant/RestaurantContext";
import { LoginScreen } from "./core/auth/LoginScreen";
import { SignupScreen } from "./core/auth/SignupScreen";
import { AppShell } from "./core/layout/AppShell";
import { HomePage } from "./core/layout/HomePage";
import { WelcomePage } from "./core/layout/WelcomePage";
import { ModulePlaceholder } from "./core/layout/ModulePlaceholder";
import { isWelcomePageHost } from "./core/restaurant/subdomain";
import { PessoasPage } from "./modules/pessoas/PessoasPage";
import { ConfiguracoesPage } from "./modules/configuracoes/ConfiguracoesPage";
import { EscalaPage } from "./modules/escala/EscalaPage";
import { FreelasPage } from "./modules/freelas/FreelasPage";
import { GorjetasPage } from "./modules/gorjetas/GorjetasPage";
import { VTPage } from "./modules/vt/VTPage";
import { ComunicadosPage } from "./modules/comunicados/ComunicadosPage";
import { IdeiasPage } from "./modules/ideias/IdeiasPage";
import { ReunioesPage } from "./modules/reunioes/ReunioesPage";
import { TrilhaPage } from "./modules/trilha/TrilhaPage";
import { OcorrenciasPage } from "./modules/ocorrencias/OcorrenciasPage";
import { ChecklistsPage } from "./modules/checklists/ChecklistsPage";
import { ReservasPage } from "./modules/reservas/ReservasPage";
import { HorariosPage } from "./modules/horarios/HorariosPage";
import { ContagensPage } from "./modules/contagens/ContagensPage";
import { ComprasPage } from "./modules/compras/ComprasPage";
import { RegistrosPontoPage } from "./modules/excecoes/RegistrosPontoPage";
import { AdmissaoPage } from "./modules/admissao/AdmissaoPage";
import { AdmissaoPublicaPage } from "./modules/admissao/AdmissaoPublicaPage";
import { EventosPage } from "./modules/eventos/EventosPage";
import { EventosPublicaPage } from "./modules/eventos/EventosPublicaPage";
import { SitesPage } from "./modules/sites/SitesPage";
import { TrabalhePublicaPage } from "./modules/sites/TrabalhePublicaPage";
import { ReservasPublicaPage } from "./modules/sites/ReservasPublicaPage";
import { SitePublicaPage } from "./modules/sites/SitePublicaPage";
import { SitePreviewPage } from "./modules/sites/SitePreviewPage";
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
    case "freelas":       return <FreelasPage key={k} />;
    case "gorjetas":      return <GorjetasPage key={k} />;
    case "vt":            return <VTPage key={k} />;
    case "comunicados":   return <ComunicadosPage key={k} />;
    case "ideias":        return <IdeiasPage key={k} />;
    case "reunioes":      return <ReunioesPage key={k} />;
    case "trilha":        return <TrilhaPage key={k} />;
    case "ocorrencias":   return <OcorrenciasPage key={k} />;
    case "checklists":    return <ChecklistsPage key={k} />;
    case "reservas":      return <ReservasPage key={k} />;
    case "horarios":      return <HorariosPage key={k} />;
    case "contagens":     return <ContagensPage key={k} />;
    case "compras":       return <ComprasPage key={k} />;
    case "excecoes":      return <RegistrosPontoPage key={k} />;
    case "admissao":      return <AdmissaoPage key={k} />;
    case "eventos":       return <EventosPage key={k} />;
    case "sites":         return <SitesPage key={k} />;
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
      <SubdomainGuard>
        <AppShell>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/arquitetura" element={<ArquiteturaPage />} />
            <Route path="/portal/:rid" element={<PortalPage />} />
            <Route path="/r/:rid/:moduleId" element={<ModuleRouter />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      </SubdomainGuard>
    </RestaurantProvider>
  );
}

// Quando o user entra via subdomain (ex: lobozo.planejamento.app), guarda
// se o restaurante existe e se a pessoa tem acesso. Caso contrário,
// mostra tela amigável em vez de derrubar todo o app.
function SubdomainGuard({ children }: { children: React.ReactNode }) {
  const { subdomain, subdomainLocked, subdomainExists, loading, restaurants } = useRestaurant();

  if (!subdomain) return <>{children}</>;
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">
        Carregando...
      </div>
    );
  }
  if (!subdomainLocked || restaurants.length === 0) {
    // Distingue 2 cenários:
    //   (a) subdomainExists = false → endereço não bate com nenhum restaurante
    //   (b) subdomainExists = true  → restaurante existe mas pessoa não tem acesso
    const enderecoErrado = !subdomainExists;
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center bg-gray-50 dark:bg-gray-950">
        <div className="max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-8 shadow-sm">
          <div className="text-5xl mb-3">{enderecoErrado ? "🤔" : "🔒"}</div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">
            {enderecoErrado
              ? "Endereço não encontrado"
              : `Sem acesso a ${subdomain}`}
          </h2>
          {enderecoErrado ? (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                <strong>{subdomain}.planejamento.app</strong> não está vinculado a nenhum
                restaurante. Verifique se o endereço está certo.
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-3">
                Não sabe o endereço do seu restaurante? Peça pro administrador.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Sua conta está logada, mas <strong>não tem permissão</strong> nesse restaurante.
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-3">
                Peça pro administrador do restaurante verificar seu vínculo,
                ou faça logout e entre com a conta certa.
              </p>
            </>
          )}
          <a
            href="https://planejamento.app"
            className="inline-block mt-5 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
          >
            ← Voltar pra planejamento.app
          </a>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/signup" element={<PublicSignup />} />
          {/* Página pública de admissão — sem auth, validação por token+email */}
          <Route path="/admissao/:token" element={<AdmissaoPublicaPage />} />
          <Route path="/eventos/:rid" element={<EventosPublicaPage />} />
          <Route path="/trabalhe/:rid" element={<TrabalhePublicaPage />} />
          <Route path="/reservas/:rid" element={<ReservasPublicaPage />} />
          <Route path="/site/:slug" element={<SitePublicaPage />} />
          <Route path="/site-preview/:rid" element={<SitePreviewPage />} />
          <Route path="*" element={<RootOrShell />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

// Root domain (planejamento.app, www.planejamento.app) → tela de boas-vindas
// que pede o subdomínio do restaurante. Outros hosts → app normal.
function RootOrShell() {
  if (isWelcomePageHost()) return <WelcomePage />;
  return <ProtectedShell />;
}

export default App;
