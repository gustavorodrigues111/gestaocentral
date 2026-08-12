// Shell autenticado do admin — agrega todos os módulos do admin num
// chunk só, separado do bundle do site público.
//
// App.tsx importa este arquivo via React.lazy(). Assim quando um cliente
// final abre lobozo.com.br, NÃO baixa nenhum dos módulos admin (Pessoas,
// Escala, Freelas, etc) — economia de ~600KB no first paint do mobile.
//
// Quando admin acessa admin.planejamento.app, esse chunk é puxado via
// Suspense e o usuário vê o splash bege por ~200-400ms até carregar.

import { useEffect } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { RestaurantProvider, useRestaurant } from "../restaurant/RestaurantContext";
import { LoginScreen } from "./LoginScreen";
import { AppShell } from "../layout/AppShell";
import { HomePage } from "../layout/HomePage";
import { ModulePlaceholder } from "../layout/ModulePlaceholder";
import { PessoasPage } from "../../modules/pessoas/PessoasPage";
import { ConfiguracoesPage } from "../../modules/configuracoes/ConfiguracoesPage";
import { EscalaPage } from "../../modules/escala/EscalaPage";
import { FreelasPage } from "../../modules/freelas/FreelasPage";
import { GorjetasPage } from "../../modules/gorjetas/GorjetasPage";
import { VTPage } from "../../modules/vt/VTPage";
import { VRPage } from "../../modules/vr/VRPage";
import { BeneficiosPage } from "../../modules/beneficios/BeneficiosPage";
import { Beneficios2Page } from "../../modules/beneficios2/Beneficios2Page";
import { ComunicadosPage } from "../../modules/comunicados/ComunicadosPage";
import { IdeiasPage } from "../../modules/ideias/IdeiasPage";
import { ReunioesPage } from "../../modules/reunioes/ReunioesPage";
import { TrilhaPage } from "../../modules/trilha/TrilhaPage";
import { OcorrenciasPage } from "../../modules/ocorrencias/OcorrenciasPage";
import { LenteEnxutaPage } from "../../modules/planoDeAcao/LenteEnxutaPage";
import { WhatsappInboxPage } from "../../modules/whatsapp/WhatsappInboxPage";
import { RotinasPage } from "../../modules/rotinas/RotinasPage";
import { ChecklistsPage } from "../../modules/checklists/ChecklistsPage";
import { ReservasPage } from "../../modules/reservas/ReservasPage";
import { HorariosPage } from "../../modules/horarios/HorariosPage";
import { ContagensPage } from "../../modules/contagens/ContagensPage";
import { ComprasPage } from "../../modules/compras/ComprasPage";
import { RecebimentoPage } from "../../modules/recebimento/RecebimentoPage";
import { FechamentoCaixaPage } from "../../modules/fechamentoCaixa/FechamentoCaixaPage";
import { RegistrosPontoPage } from "../../modules/excecoes/RegistrosPontoPage";
import { AnalisePontoPage } from "../../modules/analisePonto/AnalisePontoPage";
import { AdmissaoPage } from "../../modules/admissao/AdmissaoPage";
import { ProcessoSeletivoPage } from "../../modules/processoSeletivo/ProcessoSeletivoPage";
import { EventosPage } from "../../modules/eventos/EventosPage";
import { SitesPage } from "../../modules/sites/SitesPage";
import { CardapioPage } from "../../modules/cardapio/CardapioPage";
import { UniformesPage } from "../../modules/uniformes/UniformesPage";
import { ArquiteturaPage } from "../../modules/arquitetura/ArquiteturaPage";
import { PerfisAcessoPage } from "../../modules/perfisAcesso/PerfisAcessoPage";
import { PortalPage } from "../../modules/portalEmpregado/PortalPage";
import { TarefasPage } from "../../modules/tarefas/TarefasPage";
import { WikiProcessosPage } from "../../modules/wikiProcessos/WikiProcessosPage";
import { IaGovernancaPage } from "../../modules/iaGovernanca/IaGovernancaPage";
import { WhatsappPage } from "../../modules/whatsapp/WhatsappPage";
import { VendasPage } from "../../modules/vendas/VendasPage";
import { FaturasPage } from "../../modules/faturas/FaturasPage";
import { FolhasPage } from "../../modules/folhas/FolhasPage";
import { PrazosPage } from "../../modules/prazos/PrazosPage";
import { SegurancaPage } from "../../modules/seguranca/SegurancaPage";
import { AgentesPage } from "../../modules/agentes/AgentesPage";
import { ConectoresPage } from "../../modules/conectores/ConectoresPage";
import { EstoqueValidadePage } from "../../modules/estoqueValidade/EstoqueValidadePage";
import { FichasPage } from "../../modules/fichas/FichasPage";
import { ExamesPage } from "../../modules/exames/ExamesPage";
import { DemissaoPage } from "../../modules/demissao/DemissaoPage";
import { FerramentasCredenciaisPage } from "../../modules/ferramentasCredenciais/FerramentasCredenciaisPage";
import { ChatPage } from "../../modules/chat/ChatPage";
import { AvisosProvider } from "../../modules/chat/useAvisos";
import { PrimeiroAcesso } from "./PrimeiroAcesso";

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
    case "vr":            return <VRPage key={k} />;
    case "beneficios":    return <BeneficiosPage key={k} />;
    case "beneficios2":   return <Beneficios2Page key={k} />;
    case "comunicados":   return <ComunicadosPage key={k} />;
    case "ideias":        return <IdeiasPage key={k} />;
    case "reunioes":      return <ReunioesPage key={k} />;
    case "trilha":        return <TrilhaPage key={k} />;
    case "ocorrencias":   return <OcorrenciasPage key={k} />;
    case "planoDeAcao":   return <LenteEnxutaPage key={k} />;
    case "whatsappInbox": return <WhatsappInboxPage key={k} />;
    case "rotinas":       return <RotinasPage key={k} />;
    case "checklists":    return <ChecklistsPage key={k} />;
    case "reservas":      return <ReservasPage key={k} />;
    case "horarios":      return <HorariosPage key={k} />;
    case "contagens":     return <ContagensPage key={k} />;
    case "compras":       return <ComprasPage key={k} />;
    case "recebimento":   return <RecebimentoPage key={k} />;
    case "estoqueValidade": return <EstoqueValidadePage key={k} />;
    case "fechamentoCaixa": return <FechamentoCaixaPage key={k} />;
    case "excecoes":      return <RegistrosPontoPage key={k} />;
    case "analise-ponto": return <AnalisePontoPage key={k} />;
    case "admissao":      return <AdmissaoPage key={k} />;
    case "processoSeletivo": return <ProcessoSeletivoPage key={k} />;
    case "eventos":       return <EventosPage key={k} />;
    case "sites":         return <SitesPage key={k} />;
    case "cardapio":      return <CardapioPage key={k} />;
    case "uniformes":     return <UniformesPage key={k} />;
    case "tarefas":       return <TarefasPage key={k} />;
    case "wikiProcessos": return <WikiProcessosPage key={k} />;
    case "iaGovernanca": return <IaGovernancaPage key={k} />;
    case "whatsapp": return <WhatsappPage key={k} />;
    case "vendas":        return <VendasPage key={k} />;
    case "faturas":       return <FaturasPage key={k} />;
    case "folhas":        return <FolhasPage key={k} />;
    case "prazos":        return <PrazosPage key={k} />;
    case "seguranca":     return <SegurancaPage key={k} />;
    case "agentes":       return <AgentesPage key={k} />;
    case "conectores":    return <ConectoresPage key={k} />;
    case "fichas":        return <FichasPage key={k} />;
    case "exames":        return <ExamesPage key={k} />;
    case "demissao":      return <DemissaoPage key={k} />;
    case "ferramentasCredenciais": return <FerramentasCredenciaisPage key={k} />;
    case "chat":          return <ChatPage key={k} />;
    default:              return <ModulePlaceholder key={k} />;
  }
}

export function ProtectedShell() {
  const { fbUser, pessoa, pessoaReal, isImpersonating, loading } = useAuth();

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

  // Primeiro acesso: quem entrou com senha inicial precisa confirmar CPF +
  // criar nova senha antes de usar o app. (Master impersonando não cai aqui.)
  if (pessoaReal?.mustTrocarSenha && !isImpersonating) {
    return <PrimeiroAcesso pessoa={pessoaReal} />;
  }

  return (
    <RestaurantProvider>
      <SubdomainGuard>
        <AvisosProvider>
        <AppShell>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/arquitetura" element={<ArquiteturaPage />} />
            <Route path="/perfis" element={<PerfisAcessoPage />} />
            <Route path="/portal/:rid" element={<PortalPage />} />
            <Route path="/r/:rid/:moduleId" element={<ModuleRouter />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
        </AvisosProvider>
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

// Default export pro React.lazy() pegar
export default ProtectedShell;
