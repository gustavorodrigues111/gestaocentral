import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./core/auth/AuthContext";
import { SignupScreen } from "./core/auth/SignupScreen";
import { WelcomePage } from "./core/layout/WelcomePage";
import { isWelcomePageHost } from "./core/restaurant/subdomain";
import { AdmissaoPublicaPage } from "./modules/admissao/AdmissaoPublicaPage";
import { EventosPublicaPage } from "./modules/eventos/EventosPublicaPage";
import { TrabalhePublicaPage } from "./modules/sites/TrabalhePublicaPage";
import { VagasPublicaPage, VagaCandidaturaPage } from "./modules/processoSeletivo/VagasPublicaPage";
import { ReservasPublicaPage } from "./modules/sites/ReservasPublicaPage";
import { PoliticaPrivacidadePage } from "./modules/sites/PoliticaPrivacidadePage";
import { PrivacidadePlataformaPage } from "./modules/sites/PrivacidadePlataformaPage";
import { ExcluirDadosPage } from "./modules/sites/ExcluirDadosPage";
import { SitePublicaPage } from "./modules/sites/SitePublicaPage";
import { CardapioRedirect } from "./modules/sites/CardapioRedirect";
import { getSlugFromHost } from "./modules/sites/shared/customDomain";
import { SitePreviewPage } from "./modules/sites/SitePreviewPage";
import { CardapioPdfPrintPage } from "./modules/sites/CardapioPdfPrintPage";

// ProtectedShell (admin) carregado sob demanda — não vai no bundle do
// site público. Quando o cliente final acessa lobozo.com.br, esse chunk
// nem é baixado, economizando ~600KB de JS. O Suspense fallback (splash
// bege) só aparece pra quem cai no admin/login.
const ProtectedShell = lazy(() => import("./core/auth/ProtectedShell"));

function PublicSignup() {
  const { fbUser, loading } = useAuth();
  if (loading) return null;
  if (fbUser) return <Navigate to="/" replace />;
  return <SignupScreen />;
}

// Splash bege enquanto o chunk do admin carrega (uma única vez por sessão)
function ShellSuspenseFallback() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex", alignItems: "center", justifyContent: "center",
      backgroundColor: "#f7f3e9",
      color: "#666", fontFamily: "system-ui", fontSize: 13,
    }}>
      Carregando admin...
    </div>
  );
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
          <Route path="/vagas/:rid" element={<VagasPublicaPage />} />
          <Route path="/vaga/:rid/:vagaId" element={<VagaCandidaturaPage />} />
          <Route path="/reservas/:rid" element={<ReservasPublicaPage />} />
          <Route path="/politica/:slug" element={<PoliticaPrivacidadePage />} />
          {/* Política de privacidade da plataforma (usada pra publicar o app do WhatsApp na Meta) */}
          <Route path="/privacidade" element={<PrivacidadePlataformaPage />} />
          <Route path="/r/excluir-dados/:rid" element={<ExcluirDadosPage />} />
          <Route path="/cardapio-pdf/:rid" element={<CardapioPdfPrintPage />} />
          <Route path="/site/:slug" element={<SitePublicaPage />} />
          <Route path="/site-preview/:rid" element={<SitePreviewPage />} />
          <Route path="*" element={<RootOrShell />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

// Resolução do host raiz:
//   1) Domínio próprio de restaurante (lobozo.com.br, etc) → SitePublicaPage
//      direto, sem precisar de path /site/<slug>.
//   2) planejamento.app / www.planejamento.app → tela de boas-vindas.
//   3) admin.planejamento.app (ou qualquer outro) → app normal (login admin).
function RootOrShell() {
  const slugDoHost = getSlugFromHost();
  if (slugDoHost) {
    // Domínio próprio. Raiz → site; sub-path (ex: /cardapio, /menu) → tenta
    // atalho de cardápio (redireciona pro PDF) ou cai no site.
    const sub = window.location.pathname.replace(/^\/+|\/+$/g, "");
    if (sub === "vagas") return <VagasPublicaPage slugFromHost={slugDoHost} />;
    if (sub) return <CardapioRedirect slug={slugDoHost} sub={sub} />;
    return <SitePublicaPage slugFromHost={slugDoHost} />;
  }
  if (isWelcomePageHost()) return <WelcomePage />;
  return (
    <Suspense fallback={<ShellSuspenseFallback />}>
      <ProtectedShell />
    </Suspense>
  );
}

export default App;
